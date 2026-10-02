/**
 * The owner's half of wishlists, on `/account`.
 *
 * Two things here are the whole point and everything else is arrangement.
 *
 * **Publishing is a switch with its state written out, not a toggle with a
 * colour.** A shopper who cannot tell whether their list is visible will
 * assume the wrong one, and the expensive direction to be wrong in is
 * assuming it is private. So each list says "Private — only you can see this"
 * or "Published — anyone with your phone number can see this and buy from
 * it", in words, next to the control that changes it.
 *
 * **Making a list private again asks first, and says what it costs.** It
 * invalidates the link, which is the behaviour somebody wants and is also a
 * thing they can do by accident to a link already sitting in a family group
 * chat. `ConfirmDialog` carries the verb, the way signing out does.
 *
 * Items are added from Saved rather than from a picker over the whole
 * catalog. The heart is already how somebody says "I want this", so a
 * wishlist is a promotion of that rather than a second, parallel act of
 * curation — and it means the fill path exists without putting a fourth
 * control on every product card.
 *
 * Nothing on this page says who claimed what, because the server never sends
 * it. That is not a rendering decision: `itemsForOwner` does not select those
 * columns, so the secrecy survives somebody rewriting this file.
 */
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { QueryGate } from "@/components/admin/QueryGate";
import { Thumb } from "@/components/product/Thumb";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/hooks/useTranslation";
import { useFeature } from "@/hooks/useFeature";
import { formatPhone, normalisePhone } from "@shared/commerce/wishlist";
import { Check, Gift, Link2, Lock, Plus, ShoppingBag, Trash2, X } from "lucide-react";
import type { Product } from "@shared/commerce/types";
import { useState } from "react";
import { toast } from "sonner";

export function WishlistManager() {
  const { t } = useTranslation();
  /* Switched off (2.3): an owner keeps their lists and can read them; making
     new ones and adding to them is what closes. */
  const on = useFeature("wishlists");
  const [openList, setOpenList] = useState<number | null>(null);

  const lists = trpc.wishlists.mine.useQuery();
  const phone = trpc.wishlists.phone.useQuery();

  if (openList !== null) {
    return <ListDetail listId={openList} onBack={() => { setOpenList(null); void lists.refetch(); }} />;
  }

  return (
    <div className="space-y-5">
      <p className="max-w-prose text-sm leading-6 ink-muted">{t(on ? "wish.intro" : "wish.switchedOff")}</p>

      <PhoneCard current={phone.data ?? null} onSaved={() => void phone.refetch()} />

      <QueryGate queries={[lists]}>
        {() => (
          <>
            {(lists.data ?? []).length === 0 ? (
              <div className="rounded-[1.35rem] border border-dashed border-[#c3ccda] bg-[#fbfaf6] p-6 text-center">
                <div className="mx-auto grid size-11 place-items-center rounded-2xl bg-[#e7edf5]">
                  <Gift className="size-5 text-[#0a285a]" aria-hidden />
                </div>
                <p className="mt-3 text-sm font-extrabold text-[#0a285a]">{t("wish.empty")}</p>
                <p className="mx-auto mt-1 max-w-sm text-xs leading-5 ink-muted">{t("wish.emptyNote")}</p>
              </div>
            ) : (
              <ul className="space-y-3">
                {(lists.data ?? []).map(list => (
                  <ListRow
                    key={list.id}
                    list={list}
                    hasPhone={Boolean(phone.data)}
                    onOpen={() => setOpenList(list.id)}
                    onChanged={() => void lists.refetch()}
                  />
                ))}
              </ul>
            )}
            {on ? <NewList onCreated={() => void lists.refetch()} /> : null}
          </>
        )}
      </QueryGate>
    </div>
  );
}

/**
 * The number friends and family type.
 *
 * Validated with `normalisePhone` — the *same* function the server keys on, so
 * the form cannot accept a number the API would refuse. The failure this
 * prevents is quiet rather than loud: a number the client took and the server
 * could not key would simply never find anybody, and the shopper would blame
 * the feature.
 */
function PhoneCard({ current, onSaved }: { current: string | null; onSaved: () => void }) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const save = trpc.wishlists.setPhone.useMutation();

  const typed = value.trim();
  const valid = normalisePhone(typed) !== null;

  const submit = (next: string | null) => {
    save.mutate({ phone: next }, {
      onSuccess: () => {
        setValue("");
        onSaved();
        toast.success(t(next === null ? "wish.phoneCleared" : "wish.phoneSaved"));
      },
      onError: error => toast.error(t(error.message as "wishlist.phoneTaken")),
    });
  };

  return (
    <div className="rounded-[1.35rem] border border-[#d5dfeb] bg-white p-5">
      <h3 className="text-sm font-extrabold text-[#0a285a]">{t("wish.phoneHeading")}</h3>
      <p className="mt-1 max-w-prose text-xs leading-5 ink-muted">{t("wish.phoneNote")}</p>

      {current ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {/* A phone number is Latin whichever language the page is in, and
              belongs on the line's own side. bdi, never dir on the block. */}
          <bdi dir="ltr" className="text-base font-extrabold tracking-[.04em] text-[#0a285a]">{formatPhone(current)}</bdi>
          <button
            onClick={() => submit(null)}
            disabled={save.isPending}
            className="glass pressable rounded-full px-4 py-2 text-xs font-extrabold disabled:opacity-60"
          >
            {t("wish.phoneClear")}
          </button>
        </div>
      ) : (
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={event => { event.preventDefault(); if (valid) submit(typed); }}
        >
          <label className="min-w-0 flex-1">
            <span className="block text-[11px] font-extrabold tracking-[.1em] ink-muted uppercase">{t("wish.phoneLabel")}</span>
            <input
              value={value}
              onChange={event => setValue(event.target.value)}
              inputMode="tel"
              autoComplete="tel"
              /* dir on a form control sets the typing direction, which is the
                 one place the markup guard allows it. */
              dir="ltr"
              placeholder={t("wish.phonePlaceholder")}
              className="glass-field mt-1 w-full rounded-full px-4 py-2.5 text-sm"
            />
          </label>
          <button
            type="submit"
            disabled={!valid || save.isPending}
            className="glass glass-navy pressable rounded-full px-5 py-2.5 text-xs font-extrabold disabled:opacity-60"
          >
            {t("wish.phoneSave")}
          </button>
        </form>
      )}
    </div>
  );
}

function ListRow({ list, hasPhone, onOpen, onChanged }: {
  list: { id: number; title: string; visibility: "private" | "public"; itemCount: number };
  hasPhone: boolean;
  onOpen: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState<"unpublish" | "delete" | null>(null);
  const update = trpc.wishlists.update.useMutation();
  const remove = trpc.wishlists.remove.useMutation();
  const link = trpc.wishlists.shareLink.useQuery({ listId: list.id }, { enabled: list.visibility === "public" });

  const published = list.visibility === "public";

  const setVisibility = (visibility: "private" | "public") =>
    update.mutate({ listId: list.id, visibility }, {
      onSuccess: () => { onChanged(); void link.refetch(); setConfirming(null); },
      onError: error => toast.error(t(error.message as "wishlist.notFound")),
    });

  const copy = async () => {
    if (!link.data) return;
    await navigator.clipboard.writeText(`${window.location.origin}/gifts/${link.data}`);
    toast.success(t("wish.linkCopied"));
  };

  return (
    <li className="rounded-[1.35rem] border border-[#d5dfeb] bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <button onClick={onOpen} className="text-start">
            <h3 dir="auto" className="type-product text-lg text-[#0a285a] hover:text-[#a44a2b]">{list.title}</h3>
          </button>
          <p className="mt-0.5 text-xs ink-muted">
            {list.itemCount === 1 ? t("wish.itemCountOne") : t("wish.itemCount", { count: list.itemCount })}
          </p>
        </div>

        {/* Text first, colour second — the state is never carried by hue. */}
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-extrabold ${published ? "bg-[#d8ead8] text-[#2f5d33]" : "bg-[#e7edf5] text-[#536b8c]"}`}>
          {published ? <Gift className="size-3.5" aria-hidden /> : <Lock className="size-3.5" aria-hidden />}
          {t(published ? "wish.public" : "wish.private")}
        </span>
      </div>

      <p className="mt-2 max-w-prose text-xs leading-5 ink-muted">
        {t(published ? "wish.publicNote" : "wish.privateNote")}
      </p>
      {published && !hasPhone ? (
        <p className="mt-1 max-w-prose text-xs leading-5 ink-accent">{t("wish.phoneNeeded")}</p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button onClick={onOpen} className="glass pressable rounded-full px-4 py-2 text-xs font-extrabold">
          {t("wish.open")}
        </button>

        {published ? (
          <>
            <button
              onClick={copy}
              disabled={!link.data}
              className="glass pressable inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-extrabold disabled:opacity-60"
            >
              <Link2 className="size-3.5" aria-hidden />{t("wish.copyLink")}
            </button>
            <button
              onClick={() => setConfirming("unpublish")}
              className="glass pressable rounded-full px-4 py-2 text-xs font-extrabold"
            >
              {t("wish.unpublish")}
            </button>
          </>
        ) : (
          <button
            onClick={() => setVisibility("public")}
            disabled={update.isPending}
            className="glass glass-navy pressable rounded-full px-4 py-2 text-xs font-extrabold disabled:opacity-60"
          >
            {t("wish.publish")}
          </button>
        )}

        <button
          onClick={() => setConfirming("delete")}
          className="pressable inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-extrabold text-[#8c2f22] hover:bg-[#fdeceb]"
        >
          <Trash2 className="size-3.5" aria-hidden />{t("wish.deleteList")}
        </button>
      </div>

      <ConfirmDialog
        open={confirming === "unpublish"}
        title={t("wish.unpublishWarning")}
        body={t("wish.unpublishBody")}
        confirmLabel={t("wish.unpublishConfirm")}
        pending={update.isPending}
        onConfirm={() => setVisibility("private")}
        onClose={() => setConfirming(null)}
      />
      <ConfirmDialog
        open={confirming === "delete"}
        tone="danger"
        title={t("wish.deleteWarning", { name: list.title })}
        body={t("wish.deleteBody")}
        confirmLabel={t("wish.deleteConfirm")}
        pending={remove.isPending}
        onConfirm={() => remove.mutate({ listId: list.id }, {
          onSuccess: () => { setConfirming(null); onChanged(); },
          onError: error => toast.error(t(error.message as "wishlist.notFound")),
        })}
        onClose={() => setConfirming(null)}
      />
    </li>
  );
}

function NewList({ onCreated }: { onCreated: () => void }) {
  const { t } = useTranslation();
  const [title, setTitle] = useState("");
  const create = trpc.wishlists.create.useMutation();

  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-[1.35rem] border border-dashed border-[#c3ccda] p-5"
      onSubmit={event => {
        event.preventDefault();
        if (!title.trim()) return;
        create.mutate({ title: title.trim() }, {
          onSuccess: () => { setTitle(""); onCreated(); },
          onError: error => toast.error(t(error.message as "wishlist.tooManyLists")),
        });
      }}
    >
      <label className="min-w-0 flex-1">
        <span className="block text-[11px] font-extrabold tracking-[.1em] ink-muted uppercase">{t("wish.newListName")}</span>
        <input
          value={title}
          onChange={event => setTitle(event.target.value)}
          maxLength={120}
          placeholder={t("wish.newListPlaceholder")}
          className="glass-field mt-1 w-full rounded-full px-4 py-2.5 text-sm"
        />
      </label>
      <button
        type="submit"
        disabled={!title.trim() || create.isPending}
        className="glass glass-navy pressable inline-flex items-center gap-1.5 rounded-full px-5 py-2.5 text-xs font-extrabold disabled:opacity-60"
      >
        <Plus className="size-3.5" aria-hidden />{t("wish.create")}
      </button>
    </form>
  );
}

/** One list: what is on it, and what can be added from Saved. */
function ListDetail({ listId, onBack }: { listId: number; onBack: () => void }) {
  const { t, locale } = useTranslation();
  const on = useFeature("wishlists");
  const detail = trpc.wishlists.get.useQuery({ listId });
  const add = trpc.wishlists.addItem.useMutation();
  const drop = trpc.wishlists.removeItem.useMutation();

  /*
   * Saved is a list of ids and the catalog is where the titles live, the same
   * pairing `/saved` makes. Resolving here rather than adding a
   * products-by-id procedure keeps the wishlist from inventing a second way to
   * read the catalog for one screen.
   */
  const savedIds = trpc.customer.saved.list.useQuery();
  const catalog = trpc.commerce.products.list.useQuery({ first: 100, locale });
  const byId = new Map((catalog.data ?? []).map(product => [product.id, product]));
  const savedProducts = (savedIds.data ?? []).map(id => byId.get(id)).filter(Boolean) as Product[];

  const onList = new Set((detail.data?.items ?? []).map(item => item.productId));

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="glass pressable inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-extrabold">
        <X className="size-3.5" aria-hidden />{t("wish.back")}
      </button>

      <QueryGate queries={[detail]}>
        {() => (
          <>
            <ShownAs listId={listId} current={detail.data?.list.ownerName ?? null} onSaved={() => void detail.refetch()} />

            <div className="rounded-[1.35rem] border border-[#d5dfeb] bg-white p-5">
              <h3 dir="auto" className="type-product text-lg text-[#0a285a]">{detail.data?.list.title}</h3>
              {(detail.data?.items ?? []).length === 0 ? (
                <p className="mt-2 text-sm ink-muted">{t("wish.listEmpty")}</p>
              ) : (
                <ul className="mt-3 divide-y divide-[#e7edf5]">
                  {(detail.data?.items ?? []).map(item => (
                    <li key={item.id} className="flex items-start justify-between gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-extrabold text-[#0a285a]">
                          {byId.get(item.productId)?.title ?? item.productId}
                        </p>
                        {on ? (
                          <NoteField
                            listId={listId}
                            productId={item.productId}
                            current={item.note}
                            onSaved={() => void detail.refetch()}
                          />
                        ) : item.note ? <p dir="auto" className="mt-1 text-xs ink-muted">{item.note}</p> : null}
                      </div>
                      <button
                        onClick={() => drop.mutate({ listId, itemId: item.id }, {
                          onSuccess: () => { void detail.refetch(); toast.success(t("wish.removed")); },
                        })}
                        aria-label={t("wish.removeItem", { name: byId.get(item.productId)?.title ?? item.productId })}
                        className="glass pressable tap-target grid size-8 shrink-0 place-items-center rounded-full"
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {on ? <div className="rounded-[1.35rem] border border-[#d5dfeb] bg-white p-5">
              <h3 className="text-sm font-extrabold text-[#0a285a]">{t("wish.addFromSaved")}</h3>
              <p className="mt-1 max-w-prose text-xs leading-5 ink-muted">{t("wish.addFromSavedNote")}</p>

              {savedProducts.length === 0 ? (
                <p className="mt-3 text-sm ink-muted">{t("wish.nothingSaved")}</p>
              ) : (
                <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                  {savedProducts.map(product => (
                    <li key={product.id} className="flex items-center gap-3 rounded-2xl border border-[#e7edf5] p-2.5">
                      <div className="size-12 shrink-0 overflow-hidden rounded-xl bg-[#e7edf5]">
                        <Thumb
                          src={product.images[0]?.url}
                          alt={product.images[0]?.altText ?? product.title}
                          className="size-full object-cover"
                          icon={<ShoppingBag className="size-4" />}
                        />
                      </div>
                      <p className="min-w-0 flex-1 truncate text-sm font-extrabold text-[#0a285a]">{product.title}</p>
                      <button
                        onClick={() => add.mutate({ listId, productId: product.id }, {
                          onSuccess: () => { void detail.refetch(); toast.success(t("wish.added", { list: detail.data?.list.title ?? "" })); },
                          onError: error => toast.error(t(error.message as "wishlist.listFull")),
                        })}
                        disabled={onList.has(product.id) || add.isPending}
                        className="glass pressable inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-extrabold disabled:opacity-50"
                      >
                        {onList.has(product.id) ? <Check className="size-3.5" aria-hidden /> : <Plus className="size-3.5" aria-hidden />}
                        {t("wish.add")}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div> : null}
          </>
        )}
      </QueryGate>
    </div>
  );
}

/**
 * "The blue one, size 42."
 *
 * The note is the thing that makes a wishlist better than a list of links:
 * a product page cannot say which colour somebody meant, and a giver guessing
 * is how a present gets returned. It saves on blur rather than behind its own
 * button, because a save button per row on a list of twenty is a wall of
 * controls — the same argument the vendors page makes for splitting a row.
 */
function NoteField({ listId, productId, current, onSaved }: {
  listId: number; productId: string; current: string | null; onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(current ?? "");
  const save = trpc.wishlists.addItem.useMutation();

  const commit = () => {
    if (value.trim() === (current ?? "")) return;
    save.mutate({ listId, productId, note: value.trim() || null }, { onSuccess: onSaved });
  };

  return (
    <label className="mt-1 block">
      <span className="sr-only">{t("wish.noteLabel")}</span>
      <input
        value={value}
        onChange={event => setValue(event.target.value)}
        onBlur={commit}
        maxLength={280}
        dir="auto"
        placeholder={t("wish.notePlaceholder")}
        className="glass-field w-full rounded-full px-3 py-1.5 text-xs"
      />
    </label>
  );
}

/**
 * The name a stranger sees.
 *
 * Its own field rather than the account's display name, because those are two
 * different audiences: a gift list wants "Noura" and an invoice wants whatever
 * is on the card. Copying it onto the list is also what keeps the lookup from
 * ever having to join to `users`.
 */
function ShownAs({ listId, current, onSaved }: { listId: number; current: string | null; onSaved: () => void }) {
  const { t } = useTranslation();
  const [value, setValue] = useState(current ?? "");
  const update = trpc.wishlists.update.useMutation();

  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-[1.35rem] border border-[#d5dfeb] bg-white p-5"
      onSubmit={event => {
        event.preventDefault();
        update.mutate({ listId, ownerName: value.trim() }, {
          onSuccess: () => { onSaved(); toast.success(t("wish.savedToast")); },
        });
      }}
    >
      <label className="min-w-0 flex-1">
        <span className="block text-[11px] font-extrabold tracking-[.1em] ink-muted uppercase">{t("wish.shownAs")}</span>
        <input
          value={value}
          onChange={event => setValue(event.target.value)}
          maxLength={120}
          dir="auto"
          placeholder={t("wish.shownAsPlaceholder")}
          className="glass-field mt-1 w-full rounded-full px-4 py-2.5 text-sm"
        />
        <span className="mt-1 block text-xs ink-muted">{t("wish.shownAsNote")}</span>
      </label>
      <button
        type="submit"
        disabled={update.isPending}
        className="glass glass-navy pressable rounded-full px-5 py-2.5 text-xs font-extrabold disabled:opacity-60"
      >
        {t("account.saveChanges")}
      </button>
    </form>
  );
}
