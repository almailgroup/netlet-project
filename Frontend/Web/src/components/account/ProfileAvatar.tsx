/**
 * The account's circle wherever it is named to its owner — the account
 * home's card, the header's account control and "Your profile": the profile
 * photo when there is one (`Shared/commerce/profilePhoto.ts`), the initials
 * otherwise, and the initials again if the photo cannot be read. The photo is
 * shown to its owner alone: its address answers only the account it names
 * (`GET /api/profile/photo/:id`). Kept apart from the choosing
 * (`ProfilePhoto.tsx`) because the header carries it on every page.
 */
import { UserRound } from "lucide-react";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/hooks/useAuth";
import { appPath } from "@/lib/basePath";

/**
 * Up to two initials, from whatever we actually have.
 *
 * Falls back to the email when there is no display name, because a shopper
 * who never set one still deserves something other than a blank circle.
 * Non-Latin names work unchanged — the first character of each word is right
 * in Arabic too.
 */
export function initialsFor(user: { name: string | null; email: string | null }): string {
  /* An account made with a phone and no name yet has no letters to show. */
  const source = user.name?.trim() || user.email?.split("@")[0] || "";
  const words = source.split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return [...words[0]].slice(0, 2).join("").toUpperCase();
  return (([...words[0]][0] ?? "") + ([...words[1]][0] ?? "")).toUpperCase();
}

/** The signed-in account's photo: where to read it, and whether the shop keeps one yet. */
export function useProfilePhoto() {
  const { isAuthenticated } = useAuth();
  const photo = trpc.customer.photo.get.useQuery(undefined, { enabled: isAuthenticated, staleTime: 5 * 60_000 });
  return photo;
}

export function ProfileAvatar({ user, size, textClass, src: shown, alt = "" }: {
  user: { name: string | null; email: string | null };
  /** Tailwind size of the circle, e.g. `size-16`. */
  size: string;
  /** The initials' type, sized to the circle. */
  textClass: string;
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
  return (
    <span aria-hidden={alt === "" ? true : undefined} role={alt ? "img" : undefined} aria-label={alt || undefined} className={`grid ${size} shrink-0 place-items-center rounded-full bg-[#f1f2f6] font-bold text-[#0a285a] ${textClass}`}>
      {/* An account made with a phone and no name yet: a person, not a "?". */}
      {initialsFor(user) === "?" ? <UserRound className="size-[55%]" aria-hidden /> : initialsFor(user)}
    </span>
  );
}

