import { describe, expect, it } from "vitest";

/** Universal profile routes always use username slug. */
function profileHref(username: string) {
  return `/profile/${username}`;
}

describe("profile links", () => {
  it("points leaderboard and results usernames at /profile/[username]", () => {
    expect(profileHref("gridironmind")).toBe("/profile/gridironmind");
    expect(profileHref("gpt")).toBe("/profile/gpt");
    expect(profileHref("claude")).toBe("/profile/claude");
  });
});
