import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

/**
 * Guards against reintroducing raw Avatar URL paste fields on human surfaces.
 * Admin /users may still use avatarUrl text inputs intentionally.
 */
describe("human profile photo UI", () => {
  const humanFormFiles = [
    "components/auth/ProfileSetupForm.tsx",
    "components/auth/AccountProfileForm.tsx",
    "components/auth/ProfilePhotoField.tsx",
    "app/account/page.tsx",
    "app/account/setup/page.tsx",
  ];

  it("wires Upload Profile Photo and never shows an Avatar URL label", () => {
    for (const file of humanFormFiles) {
      const source = read(file);
      expect(source, file).not.toMatch(/Avatar URL/i);
      expect(source, file).not.toMatch(/type=["']url["']/);
    }

    expect(read("components/auth/ProfileSetupForm.tsx")).toContain(
      "ProfilePhotoField",
    );
    expect(read("components/auth/AccountProfileForm.tsx")).toContain(
      "ProfilePhotoField",
    );
    expect(read("components/auth/ProfilePhotoField.tsx")).toContain(
      "Upload Profile Photo",
    );
  });

  it("routes Edit profile from the public header to /account", () => {
    const header = read("components/profile/ProfileHeader.tsx");
    expect(header).toMatch(/href=["']\/account["']/);
    expect(header).toContain("Edit profile");
    expect(header).toContain("ProfileAvatar");
  });

  it("keeps avatarUrl URL inputs only on admin user management", () => {
    const admin = read("app/admin/users/page.tsx");
    expect(admin).toMatch(/Avatar URL/);
    expect(admin).toMatch(/name=["']avatarUrl["']/);
  });
});
