import type { AddressField } from "@/domains/forms/schema/question-types";

/**
 * Address autocomplete (F-65) with Google Places (New), called from
 * FormCraft's server so the API key never reaches a browser. Off until
 * GOOGLE_PLACES_API_KEY is set; respondents can always type the address
 * themselves. One session token per address search groups the
 * suggestions and the final details into one billable session (Google's
 * rule), and only the address parts are asked for (the cheapest field
 * mask). Nothing a respondent types is stored by FormCraft until they
 * submit it as their answer.
 */

const base = () => process.env.PLACES_API_BASE ?? "https://places.googleapis.com";

export function placesConfigured(): boolean {
  return Boolean(process.env.GOOGLE_PLACES_API_KEY);
}

export type Suggestion = { placeId: string; text: string; secondary?: string };

export class PlacesError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function call(path: string, init: RequestInit & { fieldMask: string }) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new PlacesError("Address suggestions aren't set up", 503);
  const { fieldMask, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(`${base()}${path}`, {
      ...rest,
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": key,
        "x-goog-fieldmask": fieldMask,
        ...(headers as Record<string, string> | undefined),
      },
      signal: AbortSignal.timeout(6000),
    });
  } catch {
    throw new PlacesError("Address suggestions are unavailable", 502);
  }
  if (!res.ok) {
    void res.body?.cancel();
    throw new PlacesError("Address suggestions are unavailable", 502);
  }
  return (await res.json()) as unknown;
}

export async function suggestAddresses(input: {
  text: string;
  sessionToken: string;
  countries?: string[];
  language?: string;
}): Promise<Suggestion[]> {
  const data = (await call("/v1/places:autocomplete", {
    method: "POST",
    fieldMask:
      "suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat",
    body: JSON.stringify({
      input: input.text,
      sessionToken: input.sessionToken,
      includedPrimaryTypes: ["street_address", "premise", "subpremise", "route"],
      ...(input.countries?.length
        ? { includedRegionCodes: input.countries.map((c) => c.toLowerCase()) }
        : {}),
      ...(input.language ? { languageCode: input.language } : {}),
    }),
  })) as {
    suggestions?: {
      placePrediction?: {
        placeId?: string;
        structuredFormat?: {
          mainText?: { text?: string };
          secondaryText?: { text?: string };
        };
      };
    }[];
  };
  return (data.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => !!p?.placeId)
    .slice(0, 5)
    .map((p) => ({
      placeId: p.placeId!,
      text: p.structuredFormat?.mainText?.text ?? "",
      secondary: p.structuredFormat?.secondaryText?.text,
    }))
    .filter((s) => s.text);
}

type Component = { longText?: string; shortText?: string; types?: string[] };

/** Google's address parts as the form's fields. */
export function addressFromComponents(
  components: Component[],
): Partial<Record<AddressField, string>> {
  const find = (...types: string[]) =>
    components.find((c) => types.some((t) => c.types?.includes(t)));
  const text = (c: Component | undefined) => c?.longText?.trim() || undefined;
  const number = text(find("street_number"));
  const route = text(find("route"));
  const premise = text(find("premise"));
  const line1 = [number, route].filter(Boolean).join(" ") || premise || undefined;
  const sub = text(find("subpremise"));
  const out: Partial<Record<AddressField, string>> = {
    line1,
    line2: sub ? (premise && line1 !== premise ? `${sub}, ${premise}` : sub) : undefined,
    city: text(find("locality", "postal_town", "administrative_area_level_2")),
    state: text(find("administrative_area_level_1")),
    postalCode: text(find("postal_code")),
    country: text(find("country")),
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v)) as Partial<
    Record<AddressField, string>
  >;
}

export async function placeAddress(input: {
  placeId: string;
  sessionToken: string;
  language?: string;
}): Promise<Partial<Record<AddressField, string>>> {
  const query = new URLSearchParams({ sessionToken: input.sessionToken });
  if (input.language) query.set("languageCode", input.language);
  const data = (await call(`/v1/places/${encodeURIComponent(input.placeId)}?${query}`, {
    method: "GET",
    fieldMask: "addressComponents",
  })) as { addressComponents?: Component[] };
  return addressFromComponents(data.addressComponents ?? []);
}
