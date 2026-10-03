import type { NextRequest } from "next/server";
import { SCIM_LIST_SCHEMA, SCIM_USER_SCHEMA } from "@/domains/identity/scim";
import { scimBase, scimJson, withScim } from "../shared";

const attribute = (
  name: string,
  type: "string" | "boolean",
  extra: Record<string, unknown> = {},
) => ({
  name,
  type,
  multiValued: false,
  required: false,
  caseExact: false,
  mutability: "readWrite",
  returned: "default",
  uniqueness: "none",
  ...extra,
});

/** The attributes of a User that are stored; others are ignored. */
export async function GET(request: NextRequest) {
  return withScim(request, async () =>
    scimJson({
      schemas: [SCIM_LIST_SCHEMA],
      totalResults: 1,
      startIndex: 1,
      itemsPerPage: 1,
      Resources: [
        {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:Schema"],
          id: SCIM_USER_SCHEMA,
          name: "User",
          description: "A person allowed into the workspace",
          attributes: [
            attribute("userName", "string", { required: true, uniqueness: "server" }),
            attribute("displayName", "string"),
            attribute("externalId", "string", { caseExact: true }),
            attribute("active", "boolean"),
          ],
          meta: {
            resourceType: "Schema",
            location: `${scimBase(request)}/Schemas/${SCIM_USER_SCHEMA}`,
          },
        },
      ],
    }),
  );
}
