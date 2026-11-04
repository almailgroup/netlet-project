/**
 * The account's profile photo (`Shared/commerce/profilePhoto.ts`), on the
 * owner's word: "users can set profile picture for their profiles".
 *
 * `ProfilePhotoCard` is the choosing, on "Your profile": a photo is cropped to
 * a square on the device and shown in the circle before anything is sent, and
 * Save is what sends it — the page's rule that each card is its own decision.
 * Remove asks first. Before migration 0076 is pasted the card is not drawn and
 * the circle is the initials, so nothing offers what cannot be kept.
 */
import { useEffect, useRef, useState } from "react";
import { Camera, LoaderCircle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/hooks/useTranslation";
import { appPath } from "@/lib/basePath";
import { isMessageKey } from "@shared/i18n/dictionary";
import { prepareProfilePhoto, type PreparedProfilePhoto } from "@/lib/prepareProfilePhoto";
import { ProfileAvatar, useProfilePhoto } from "@/components/account/ProfileAvatar";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ProfileCard, primary, secondary } from "@/components/account/profileParts";
import { pressHaptic } from "@/lib/haptics";

export function ProfilePhotoCard({ user }: { user: { name: string | null; email: string } }) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const photo = useProfilePhoto();
  const input = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<(PreparedProfilePhoto & { url: string }) | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const remove = trpc.customer.photo.remove.useMutation({
    onSuccess: async () => {
      await utils.customer.photo.get.invalidate();
      setConfirming(false);
      toast.success(t("profilePhoto.removed"));
    },
    onError: error => toast.error(isMessageKey(error.message) ? t(error.message) : t("admin.saveFailed")),
  });

  /* The preview's address is the browser's own; let it go when it is replaced or left. */
  useEffect(() => () => { if (chosen) URL.revokeObjectURL(chosen.url); }, [chosen]);

  if (!photo.data?.ready) return null;
  const has = Boolean(photo.data.url);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setPreparing(true);
    const prepared = await prepareProfilePhoto(file);
    setPreparing(false);
    if (typeof prepared === "string") { toast.error(t(prepared)); return; }
    setChosen({ ...prepared, url: URL.createObjectURL(prepared.blob) });
  };

  const save = async () => {
    if (!chosen) return;
    setSaving(true);
    try {
      const response = await fetch(appPath("/api/media/profile"), {
        method: "POST",
        headers: { "Content-Type": chosen.type },
        body: chosen.blob,
        credentials: "same-origin",
      });
      const answer = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        toast.error(answer.error && isMessageKey(answer.error) ? t(answer.error) : t("media.failed"));
        return;
      }
      await utils.customer.photo.get.invalidate();
      setChosen(null);
      toast.success(t("profilePhoto.saved"));
    } catch {
      toast.error(t("media.failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ProfileCard title={t("profilePhoto.title")} note={t("profilePhoto.note")}>
      <div className="flex flex-wrap items-center gap-4">
        <ProfileAvatar user={user} size="size-24" textClass="text-[30px]" src={chosen?.url} alt={t("profilePhoto.alt")} />
        {/* A basis of its own, so on a narrow phone the buttons go under the
            circle rather than breaking their words in two beside it. */}
        <div className="flex min-w-0 flex-1 basis-44 flex-wrap gap-2 [&>button]:whitespace-nowrap">
          {chosen ? (
            <>
              <p className="w-full text-[14px] leading-5 text-[#1f2a44]" role="status">{t("profilePhoto.preview")}</p>
              <button type="button" className={primary} disabled={saving} onClick={() => { pressHaptic(); void save(); }}>
                {saving ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
                {t("profilePhoto.save")}
              </button>
              <button type="button" className={secondary} disabled={saving} onClick={() => setChosen(null)}>{t("common.cancel")}</button>
            </>
          ) : (
            <>
              <button type="button" className={secondary} disabled={preparing} onClick={() => input.current?.click()}>
                {preparing ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Camera className="size-4" aria-hidden />}
                {preparing ? t("profilePhoto.preparing") : t(has ? "profilePhoto.change" : "profilePhoto.add")}
              </button>
              {has ? (
                <button type="button" className={secondary} onClick={() => setConfirming(true)}>
                  <Trash2 className="size-4" aria-hidden />
                  {t("profilePhoto.remove")}
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
      {/* The browser's own picker: a phone offers its camera and its photos. */}
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={event => {
          void choose(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <ConfirmDialog
        open={confirming}
        title={t("profilePhoto.removeTitle")}
        body={t("profilePhoto.removeBody")}
        confirmLabel={t("profilePhoto.remove")}
        tone="danger"
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
        onClose={() => setConfirming(false)}
      />
    </ProfileCard>
  );
}
