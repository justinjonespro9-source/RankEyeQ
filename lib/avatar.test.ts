import { describe, expect, it } from "vitest";
import {
  displayInitials,
  isUploadedAvatarUrl,
  resolveAvatarUrl,
} from "@/lib/avatar";

describe("resolveAvatarUrl precedence", () => {
  it("prefers uploaded / profile avatarUrl over Google oauth image", () => {
    expect(
      resolveAvatarUrl({
        avatarUrl: "https://blob.example/avatar.jpg",
        oauthImageUrl: "https://lh3.googleusercontent.com/a/photo",
      }),
    ).toBe("https://blob.example/avatar.jpg");
  });

  it("falls back to Google oauth image when profile avatar is empty", () => {
    expect(
      resolveAvatarUrl({
        avatarUrl: null,
        oauthImageUrl: "https://lh3.googleusercontent.com/a/photo",
      }),
    ).toBe("https://lh3.googleusercontent.com/a/photo");
    expect(
      resolveAvatarUrl({
        avatarUrl: "   ",
        oauthImageUrl: "https://lh3.googleusercontent.com/a/photo",
      }),
    ).toBe("https://lh3.googleusercontent.com/a/photo");
  });

  it("returns null when neither image exists (initials fallback)", () => {
    expect(resolveAvatarUrl({ avatarUrl: null, oauthImageUrl: null })).toBeNull();
    expect(resolveAvatarUrl({})).toBeNull();
  });
});

describe("displayInitials", () => {
  it("builds two-letter initials from display names", () => {
    expect(displayInitials("Gridiron Mind")).toBe("GM");
    expect(displayInitials("Solo")).toBe("SO");
    expect(displayInitials("")).toBe("?");
  });
});

describe("isUploadedAvatarUrl", () => {
  it("detects Vercel Blob hosts only", () => {
    expect(
      isUploadedAvatarUrl(
        "https://abc.public.blob.vercel-storage.com/avatars/x.jpg",
      ),
    ).toBe(true);
    expect(
      isUploadedAvatarUrl("https://lh3.googleusercontent.com/a/photo"),
    ).toBe(false);
    expect(isUploadedAvatarUrl(null)).toBe(false);
  });
});
