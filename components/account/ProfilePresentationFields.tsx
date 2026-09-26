import type { AccountProfileContentDefaults } from "@/components/auth/AccountProfileForm";

const INPUT_CLASS =
  "mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2 text-ink";

/**
 * Owner-controlled presentation fields for claimed Expert / Creator profiles.
 * RankEyeQ competitive data and weekly source provenance are not editable here.
 */
export function ProfilePresentationFields({
  content,
}: {
  content: AccountProfileContentDefaults;
}) {
  const socials = [
    ["websiteUrl", "Website", content.websiteUrl],
    ["xUrl", "X", content.xUrl],
    ["youtubeUrl", "YouTube", content.youtubeUrl],
    ["instagramUrl", "Instagram", content.instagramUrl],
    ["tiktokUrl", "TikTok", content.tiktokUrl],
    ["podcastUrl", "Podcast", content.podcastUrl],
  ] as const;

  return (
    <div className="space-y-4 border-t border-border pt-4">
      <div>
        <p className="text-sm font-medium text-ink">Public presentation</p>
        <p className="mt-0.5 text-xs text-muted">
          Shown on your public profile. Full https:// links only.
        </p>
      </div>
      <label className="block text-sm">
        <span className="font-medium text-ink">Headline</span>
        <input
          name="headline"
          defaultValue={content.headline ?? ""}
          placeholder="Fantasy Football Analyst"
          maxLength={120}
          className={INPUT_CLASS}
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-ink">Affiliation</span>
        <input
          name="affiliation"
          defaultValue={content.affiliation ?? ""}
          placeholder="Publication or brand"
          maxLength={120}
          className={INPUT_CLASS}
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-ink">Bio</span>
        <textarea
          name="bio"
          defaultValue={content.bio ?? ""}
          rows={3}
          maxLength={1000}
          className={INPUT_CLASS}
        />
      </label>
      {socials.map(([name, label, value]) => (
        <label key={name} className="block text-sm">
          <span className="font-medium text-ink">{label}</span>
          <input
            name={name}
            type="url"
            defaultValue={value ?? ""}
            placeholder="https://"
            className={INPUT_CLASS}
          />
        </label>
      ))}
      <label className="block text-sm">
        <span className="font-medium text-ink">Featured link title</span>
        <input
          name="featuredLinkTitle"
          defaultValue={content.featuredLinkTitle ?? ""}
          maxLength={160}
          placeholder="Week 4 Rankings Breakdown"
          className={INPUT_CLASS}
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-ink">Featured link URL</span>
        <input
          name="featuredLinkUrl"
          type="url"
          defaultValue={content.featuredLinkUrl ?? ""}
          placeholder="https://"
          className={INPUT_CLASS}
        />
      </label>
    </div>
  );
}
