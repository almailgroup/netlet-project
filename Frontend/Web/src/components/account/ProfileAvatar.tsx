/**
 * The account's circle wherever it is named to its owner — the account
 * home's card, the header's account control and "Your profile": the profile
 * photo when there is one (`Shared/commerce/profilePhoto.ts`), and a default
 * avatar otherwise, or if the photo cannot be read. The photo is shown to its
 * owner alone: its address answers only the account it names
 * (`GET /api/profile/photo/:id`). Kept apart from the choosing
 * (`ProfilePhoto.tsx`) because the header carries it on every page.
 *
 * **No photo is a default avatar, never the initials, on the owner's word**
 * ("instead of initials being shown for default profile page, just make it a
 * default avatar instead"): a person drawn in the muted navy on a pale ground,
 * the shape a phone's own contacts use, so a new account looks finished rather
 * than labelled. It is the same drawing in the app (`DefaultAvatar`).
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/hooks/useAuth";
import { appPath } from "@/lib/basePath";

/** The signed-in account's photo: where to read it, and whether the shop keeps one yet. */
export function useProfilePhoto() {
  const { isAuthenticated } = useAuth();
  const photo = trpc.customer.photo.get.useQuery(undefined, { enabled: isAuthenticated, staleTime: 5 * 60_000 });
  return photo;
}

/**
 * A person on a pale circle: a head and shoulders cut by the circle's edge, as
 * a phone's contacts draw somebody with no photo. On a 64 grid, so the app's
 * `DefaultAvatar` draws it from the same numbers.
 */
export function DefaultAvatar({ size, label }: { size: string; label?: string }) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      className={`block ${size} shrink-0 overflow-hidden rounded-full bg-[#e7ecf3]`}
    >
      <svg viewBox="0 0 64 64" className="block size-full" aria-hidden focusable="false">
        <circle cx="32" cy="25" r="11" fill="#a2b0c5" />
        <ellipse cx="32" cy="60" rx="21" ry="16" fill="#a2b0c5" />
      </svg>
    </span>
  );
}

export function ProfileAvatar({ size, src: shown, alt = "" }: {
  /** Tailwind size of the circle, e.g. `size-16`. */
  size: string;
  /** A photo to show instead of the saved one — the one being chosen. */
  src?: string | null;
  /** Empty beside the name, which already says whose it is. */
  alt?: string;
}) {
  const photo = useProfilePhoto();
  const saved = photo.data?.url ? appPath(photo.data.url) : null;
  const src = shown ?? saved;
  const [failed, setFailed] = useState<string | null>(null);
  if (src && failed !== src) {
    return (
      <img
        src={src}
        alt={alt}
        loading="eager"
        decoding="async"
        onError={() => setFailed(src)}
        className={`${size} shrink-0 rounded-full bg-[#f1f2f6] object-cover`}
      />
    );
  }
  return <DefaultAvatar size={size} label={alt} />;
}
