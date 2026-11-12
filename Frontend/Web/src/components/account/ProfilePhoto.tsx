/**
 * The first row of "Your profile": the photo with the name beside it, on the
 * owner's word ("put the name next to the profile photo, not below it"). The
 * photo (`Shared/commerce/profilePhoto.ts`, "users can set profile picture for
 * their profiles") and the name were two rows, one under the other; they are
 * one now, the way a phone's own account page leads.
 *
 * The name's Edit sits at the row's end, and pressed, the row's foot is the
 * name's form (`ProfileManager` hands it in) while the photo and the name stay
 * where they were. The photo's presses are under the name: a photo is cropped
 * to a square on the device and shown in the circle before anything is sent,
 * and Save is what sends it — the page's rule that each detail is its own
 * decision. Remove asks first. Before migration 0076 is pasted the photo's
 * presses are not drawn and the circle is the default avatar, so nothing
 * offers what cannot be kept.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Camera, LoaderCircle, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/hooks/useTranslation";
import { appPath } from "@/lib/basePath";
import { isMessageKey } from "@shared/i18n/dictionary";
import { prepareProfilePhoto, type PreparedProfilePhoto } from "@/lib/prepareProfilePhoto";
import { ProfileAvatar, useProfilePhoto } from "@/components/account/ProfileAvatar";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { pressHaptic } from "@/lib/haptics";

export function ProfileIdentity({ name, editing, onEdit, children }: {
  /** The name as saved, or null while there is none. */
  name: string | null;
  /** Whether the name's form is open, drawn at the row's foot. */
  editing: boolean;
  onEdit: () => void;
  /** The name's form. */
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const photo = useProfilePhoto();
  const input = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLDivElement>(null);
  const press = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(editing);
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

  /* Opening puts the keyboard in the form's first box; closing puts it back on Edit. */
  useEffect(() => {
    if (editing && !wasEditing.current) form.current?.querySelector<HTMLElement>("input, button")?.focus();
    else if (!editing && wasEditing.current) press.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  const keepsPhotos = Boolean(photo.data?.ready);
  const has = Boolean(photo.data?.url);

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

  const small = "inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full border border-[#d5dfeb] bg-white px-4 text-[14px] font-semibold text-[#0a285a] hover:bg-[#f0f2f5] disabled:opacity-50 pointer-fine:min-h-9";
  return (
    <div className="relative px-5 py-4 sm:px-6">
      <div className="flex items-start gap-4">
        <ProfileAvatar size="size-16" src={chosen?.url} alt={keepsPhotos ? t("profilePhoto.alt") : ""} />
        <div className="min-w-0 flex-1 self-center">
          <h3 className="sr-only">{t("profile.nameTitle")}</h3>
          {name ? (
            <p dir="auto" className="break-words text-[18px] font-bold leading-6 text-[#0a285a]">{name}</p>
          ) : (
            <p className="text-[16px] font-medium leading-6 ink-muted">{t("profile.notAdded")}</p>
          )}
          {keepsPhotos && !editing ? (
            <div role="group" aria-label={t("profilePhoto.title")} className="mt-2">
              {chosen ? <p role="status" className="mb-2 text-[13px] leading-5 text-[#1f2a44]">{t("profilePhoto.preview")}</p> : null}
              <div className="flex flex-wrap gap-2">
                {chosen ? (
                  <>
                    <button type="button" className={`${small} border-[#0a285a] bg-[#0a285a] text-white hover:bg-[#0d3372]`} disabled={saving} onClick={() => { pressHaptic(); void save(); }}>
                      {saving ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
                      {t("profilePhoto.save")}
                    </button>
                    <button type="button" className={small} disabled={saving} onClick={() => setChosen(null)}>{t("common.cancel")}</button>
                  </>
                ) : (
                  <>
                    <button type="button" className={small} disabled={preparing} onClick={() => input.current?.click()}>
                      {preparing ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Camera className="size-4" aria-hidden />}
                      {preparing ? t("profilePhoto.preparing") : t(has ? "profilePhoto.change" : "profilePhoto.add")}
                    </button>
                    {has ? (
                      <button type="button" className={small} onClick={() => setConfirming(true)}>
                        <Trash2 className="size-4" aria-hidden />
                        {t("profilePhoto.remove")}
                      </button>
                    ) : null}
                  </>
                )}
              </div>
              {chosen ? null : <p className="mt-2 text-[12px] leading-4 ink-muted">{t("profilePhoto.note")}</p>}
            </div>
          ) : null}
        </div>
        {editing ? null : (
          <button
            ref={press}
            type="button"
            onClick={onEdit}
            aria-label={t("profile.editField", { field: t("profile.nameTitle") })}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-[14px] font-semibold text-[#0a285a] hover:bg-[#0a285a]/[.06] pointer-fine:min-h-9"
          >
            <Pencil className="size-4" aria-hidden />
            {t(name ? "profile.edit" : "profile.add")}
          </button>
        )}
      </div>
      {editing ? <div ref={form} className="mt-4">{children}</div> : null}
      {/* The browser's own picker: a phone offers its camera and its photos. */}
      {keepsPhotos ? (
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
      ) : null}
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
    </div>
  );
}
