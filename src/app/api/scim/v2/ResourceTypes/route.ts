import type { NextRequest } from "next/server";
import { SCIM_LIST_SCHEMA, SCIM_USER_SCHEMA } from "@/domains/identity/scim";
import { scimBase, scimJson, withScim } from "../shared";

/** Only Users are provisioned (roles are set inside FormCraft). */
export async function GET(request: NextRequest) {
  return withScim(request, async () =>
    scimJson({
      schemas: [SCIM_LIST_SCHEMA],
      totalResults: 1,
      startIndex: 1,
      itemsPerPage: 1,
      Resources: [
        {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
          id: "User",
          name: "User",
          endpoint: "/Users",
          description: "A person allowed into the workspace",
          schema: SCIM_USER_SCHEMA,
          meta: {
            resourceType: "ResourceType",
            location: `${scimBase(request)}/ResourceTypes/User`,
          },
        },
      ],
    }),
  );
}
