import type { NextRequest } from "next/server";
import { SCIM_MAX_RESULTS } from "@/domains/identity/scim";
import { scimBase, scimJson, withScim } from "../shared";

/** What this SCIM service supports, for the identity provider. */
export async function GET(request: NextRequest) {
  return withScim(request, async () =>
    scimJson({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: SCIM_MAX_RESULTS },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [
        {
          type: "oauthbearertoken",
          name: "Bearer token",
          description: "The workspace's SCIM token, sent as a Bearer token.",
          primary: true,
        },
      ],
      meta: {
        resourceType: "ServiceProviderConfig",
        location: `${scimBase(request)}/ServiceProviderConfig`,
      },
    }),
  );
}
