// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  parseScimFilter,
  readScimPatch,
  readScimUser,
  ScimError,
  toScimUser,
} from "@/domains/identity/scim";
import { emailDomain, ssoProviderIds } from "@/domains/identity/sso";

describe("SCIM bodies", () => {
  it("reads a user the way Okta and Entra send one", () => {
    expect(
      readScimUser({
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        userName: " Ada@Example.com ",
        name: { givenName: "Ada", familyName: "Lovelace" },
        externalId: "00u1",
        active: true,
      }),
    ).toEqual({
      email: "ada@example.com",
      displayName: "Ada Lovelace",
      externalId: "00u1",
      active: true,
    });
    // A userName that isn't an email falls back to the primary email.
    expect(
      readScimUser({
        userName: "ada",
        emails: [
          { value: "other@example.com" },
          { value: "ada@example.com", primary: true },
        ],
        active: false,
      }),
    ).toMatchObject({ email: "ada@example.com", active: false, displayName: null });
    expect(() => readScimUser({ userName: "ada" })).toThrow(ScimError);
  });

  it("supports the lookup filter and refuses others", () => {
    expect(parseScimFilter(null)).toBeNull();
    expect(parseScimFilter('userName eq "Ada@Example.com"')).toBe("ada@example.com");
    expect(parseScimFilter('emails.value eq "a@b.co"')).toBe("a@b.co");
    expect(() => parseScimFilter('displayName co "Ada"')).toThrow("Only userName eq");
  });

  it("turns PATCH operations into fields, by path or by value object", () => {
    expect(
      readScimPatch({ Operations: [{ op: "Replace", path: "active", value: "False" }] }),
    ).toEqual({ active: false });
    expect(
      readScimPatch({
        Operations: [
          { op: "replace", value: { active: true, displayName: "Ada L", title: "CTO" } },
          { op: "add", path: "externalId", value: "x1" },
        ],
      }),
    ).toEqual({ active: true, displayName: "Ada L", externalId: "x1" });
    expect(() =>
      readScimPatch({ Operations: [{ op: "remove", path: "active" }] }),
    ).toThrow(ScimError);
    expect(() => readScimPatch({})).toThrow("Operations is required.");
  });

  it("describes a user as a SCIM resource", () => {
    const resource = toScimUser(
      {
        id: "7b0e5c2e-7c0b-4d6c-9a43-1d6c2f0a9e11",
        workspace_id: "w",
        email: "ada@example.com",
        display_name: "Ada",
        external_id: null,
        active: true,
        user_id: null,
        created_at: "2026-10-03T00:00:00Z",
        updated_at: "2026-10-03T00:00:00Z",
      },
      "https://app.example/api/scim/v2",
    );
    expect(resource).toMatchObject({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      userName: "ada@example.com",
      displayName: "Ada",
      emails: [{ value: "ada@example.com", primary: true }],
      active: true,
      meta: {
        resourceType: "User",
        location:
          "https://app.example/api/scim/v2/Users/7b0e5c2e-7c0b-4d6c-9a43-1d6c2f0a9e11",
      },
    });
    expect(resource).not.toHaveProperty("externalId");
  });
});

describe("SSO helpers", () => {
  it("reads the domain from a work email", () => {
    expect(emailDomain(" Ada@Example.CO.uk ")).toBe("example.co.uk");
    expect(emailDomain("ada")).toBeNull();
    expect(emailDomain("ada@localhost")).toBeNull();
  });

  it("finds the SSO providers a user signed in with", () => {
    expect(
      ssoProviderIds({
        app_metadata: { provider: "sso:p1", providers: ["email", "sso:p1", "sso:p2"] },
      }),
    ).toEqual(["p1", "p2"]);
    expect(ssoProviderIds({ app_metadata: { provider: "email" } })).toEqual([]);
  });
});
