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
 * **The heart fills them**, on the owner's word: pressing it asks whether
 * the product goes on the private or the public wishlist (`WishChooser`),
 * so the lists are grouped here the same way — public, then private, each
 * saying who can see it. A list can still be filled from Saved, and made
 * private or public afterwards.
 *
 * Nothing on this page says who claimed what, because the server never sends
 * it. That is not a rendering decision: `itemsForOwner` does not select those
 * columns, so the secrecy survives somebody rewriting this file.
 */
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { QueryGate } from "@/components/admin/QueryGate";
import { Thumb } from "@/components/product/Thumb";
import { appPath } from "@/lib/basePath";
import { formatMoney } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/hooks/useTranslation";
import { useFeature } from "@/hooks/useFeature";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useProductsByIds } from "@/hooks/useCatalog";
import { formatPhone, normalisePhone } from "@shared/commerce/wishlist";
import { ArrowLeft, Check, Eye, Gift, Link2, Lock, Plus, Share2, ShoppingBag, Trash2 } from "lucide-react";
import type { Product } from "@shared/commerce/types";
import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { DiscButton } from "@/components/ui/DiscButton";

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

      <QueryGate audience="shopper" queries={[lists]}>
        {() => (
          <>
            {/* Public first and private second, each under a heading that says
                who can see it — the heart asks which, so the page answers the
                same question in the same words. */}
            {(["public", "private"] as const).map(visibility => {
              const group = (lists.data ?? []).filter(list => list.visibility === visibility);
              const isPublic = visibility === "public";
              return (
                <section key={visibility} aria-labelledby={`wish-group-${visibility}`} className="space-y-3">
                  <div className="flex items-start gap-3">
                    <span className={`grid size-10 shrink-0 place-items-center rounded-2xl ${isPublic ? "bg-[#d8ead8] text-[#2f5d33]" : "bg-[#e7edf5] text-[#0a285a]"}`}>
                      {isPublic ? <Gift className="size-5" aria-hidden /> : <Lock className="size-5" aria-hidden />}
                    </span>
                    <div className="min-w-0">
                      <h3 id={`wish-group-${visibility}`} className="text-base font-extrabold text-[#0a285a]">{t(isPublic ? "wish.publicGroup" : "wish.privateGroup")}</h3>
                      <p className="mt-0.5 max-w-prose text-sm leading-5 ink-muted">{t(isPublic ? "wish.publicGroupNote" : "wish.privateGroupNote")}</p>
                    </div>
                  </div>
                  {group.length === 0 ? (
                    <p className="rounded-[1.35rem] border border-dashed border-[#c3ccda] bg-[#fbfaf6] px-5 py-4 text-sm leading-5 ink-muted">
                      {t(isPublic ? "wish.noPublic" : "wish.noPrivate")}
                    </p>
                  ) : (
                    <ul className="space-y-3">
                      {group.map(list => (
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
                </section>
              );
            })}
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
            <span className="block text-[12px] font-semibold ink-muted">{t("wish.phoneLabel")}</span>
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
  const utils = trpc.useUtils();
  const link = trpc.wishlists.shareLink.useQuery({ listId: list.id }, { enabled: list.visibility === "public" });

  const published = list.visibility === "public";

  const setVisibility = (visibility: "private" | "public") =>
    update.mutate({ listId: list.id, visibility }, {
      onSuccess: () => { onChanged(); void link.refetch(); setConfirming(null); },
      onError: error => toast.error(t(error.message as "wishlist.notFound")),
    });

  /*
   * A phone hands the link to its own share sheet — WhatsApp, Messages — which
   * is where a family list is sent; a computer copies it. Either way the
   * address carries the site's base path, which the first version left off,
   * and a browser that refuses the clipboard is shown the link to copy by hand
   * rather than told nothing.
   */
  const touch = useMediaQuery("(pointer: coarse)");
  const canShare = touch && typeof navigator !== "undefined" && typeof navigator.share === "function";
  const [showLink, setShowLink] = useState(false);
  const url = link.data ? `${window.location.origin}${appPath(`/gifts/${link.data}`)}` : "";
  const share = async () => {
    if (!url) return;
    if (canShare) {
      try {
        await navigator.share({ title: list.title, url });
        return;
      } catch (error) {
        /* Closing the sheet is an answer, not a failure. */
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t("wish.linkCopied"));
    } catch {
      setShowLink(true);
    }
  };

  return (
    <li className="rounded-[1.35rem] border border-[#d5dfeb] bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {/* The heading holds the button, never the other way round: a
              heading inside a button is no heading to a screen reader. */}
          <h4 dir="auto" className="type-product text-lg text-[#0a285a]">
            <button type="button" onClick={onOpen} className="text-start hover:text-[#a44a2b]">{list.title}</button>
          </h4>
          <p className="mt-0.5 text-xs ink-muted">
            {list.itemCount === 1 ? t("wish.itemCountOne") : t("wish.itemCount", { count: list.itemCount })}
          </p>
        </div>

        {/* Text first, colour second — the state is never carried by hue. */}
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-extrabold ${published ? "bg-[#d8ead8] text-[#2f5d33]" : "bg-[#e7edf5] text-[#536b8c]"}`}>
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
              onClick={share}
              disabled={!link.data}
              className="glass pressable inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-extrabold disabled:opacity-60"
            >
              {canShare
                ? <><Share2 className="size-3.5" aria-hidden />{t("wish.shareLink")}</>
                : <><Link2 className="size-3.5" aria-hidden />{t("wish.copyLink")}</>}
            </button>
            {link.data ? (
              <Link
                href={`/gifts/${link.data}`}
                className="glass pressable inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-extrabold"
              >
                <Eye className="size-3.5" aria-hidden />{t("wish.viewAsVisitor")}
              </Link>
            ) : null}
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
      {showLink && url ? (
        <label className="mt-3 block">
          <span className="block text-[12px] font-semibold ink-muted">{t("wish.linkLabel")}</span>
          <input
            readOnly
            value={url}
            /* dir on a form control sets the typing direction — allowed. */
            dir="ltr"
            onFocus={event => event.currentTarget.select()}
            className="glass-field mt-1 w-full rounded-full px-4 py-2.5 text-sm"
          />
        </label>
      ) : null}

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
          onSuccess: () => { setConfirming(null); onChanged(); void utils.wishlists.wishedIds.invalidate(); },
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
        <span className="block text-[12px] font-semibold ink-muted">{t("wish.newListName")}</span>
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
  /* What is on a list fills its heart everywhere (`wishedIds`). */
  const utils = trpc.useUtils();

  /*
   * Saved is a list of ids, and so is the list. Both are read by id, in one
   * request — they were looked up in the newest hundred products, so anything
   * older showed its number where its name belonged.
   */
  const savedIds = trpc.customer.saved.list.useQuery();
  const items = detail.data?.items ?? [];
  const products = useProductsByIds([...items.map(item => item.productId), ...(savedIds.data ?? [])]);
  const savedProducts = (savedIds.data ?? []).flatMap(id => products.byId.get(id) ?? []);
  const nameOf = (productId: string) => products.byId.get(productId)?.title ?? (products.settled ? t("product.unavailable") : "");

  const onList = new Set(items.map(item => item.productId));

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="glass pressable inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-extrabold">
        <ArrowLeft className="size-3.5 rtl:-scale-x-100" aria-hidden />{t("wish.back")}
      </button>

      <QueryGate audience="shopper" queries={[detail]}>
        {() => (
          <>
            <ShownAs listId={listId} current={detail.data?.list.ownerName ?? null} onSaved={() => void detail.refetch()} />

            <div className="rounded-[1.35rem] border border-[#d5dfeb] bg-white p-5">
              <h3 dir="auto" className="type-product text-lg text-[#0a285a]">{detail.data?.list.title}</h3>
              {items.length === 0 ? (
                <p className="mt-2 text-sm ink-muted">{t("wish.listEmpty")}</p>
              ) : (
                <ul className="mt-3 divide-y divide-[#e7edf5]">
                  {items.map(item => {
                    const product = products.byId.get(item.productId) ?? null;
                    const href = product ? `/products/${encodeURIComponent(product.handle)}` : null;
                    return (
                      <li key={item.id} className="flex items-start gap-3 py-3">
                        <ItemPhoto product={product} href={href} waiting={!product && !products.settled} />
                        <div className="min-w-0 flex-1">
                          {href ? (
                            <Link href={href} dir="auto" className="line-clamp-2 text-sm font-extrabold text-[#0a285a] hover:text-[#a44a2b]">
                              {product?.title}
                            </Link>
                          ) : (
                            <p className={`text-sm font-extrabold ${products.settled ? "ink-muted" : "text-[#0a285a]"}`}>{nameOf(item.productId) || "\u00a0"}</p>
                          )}
                          {product ? (
                            <p className="text-xs font-semibold text-[#0a285a]">{formatMoney(product.priceRange.min, { locale })}</p>
                          ) : null}
                          {on ? (
                            <NoteField
                              listId={listId}
                              productId={item.productId}
                              current={item.note}
                              onSaved={() => void detail.refetch()}
                            />
                          ) : item.note ? <p dir="auto" className="mt-1 text-xs ink-muted">{item.note}</p> : null}
                        </div>
                        <DiscButton
                          onClick={() => drop.mutate({ listId, itemId: item.id }, {
                            onSuccess: () => { void detail.refetch(); void utils.wishlists.wishedIds.invalidate(); toast.success(t("wish.removed")); },
                          })}
                          aria-label={t("wish.removeItem", { name: nameOf(item.productId) || item.productId })}
                          className="-m-1.5"
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                        </DiscButton>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {on ? <div className="rounded-[1.35rem] border border-[#d5dfeb] bg-white p-5">
              <h3 className="text-sm font-extrabold text-[#0a285a]">{t("wish.addFromSaved")}</h3>
              <p className="mt-1 max-w-prose text-xs leading-5 ink-muted">{t("wish.addFromSavedNote")}</p>

              {products.waiting && (savedIds.data ?? []).length > 0 ? (
                <div aria-hidden className="mt-3 grid gap-2 sm:grid-cols-2">
                  {[0, 1].map(index => <div key={index} className="h-[4.25rem] animate-pulse rounded-2xl bg-[#f3f5f9]" />)}
                </div>
              ) : savedProducts.length === 0 ? (
                <p className="mt-3 text-sm ink-muted">{t("wish.nothingSaved")}</p>
              ) : (
                <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                  {savedProducts.map(product => {
                    const already = onList.has(product.id);
                    return (
                      <li key={product.id} className="flex min-w-0 items-center gap-3 rounded-2xl border border-[#e7edf5] p-2.5">
                        <div className="size-12 shrink-0 overflow-hidden rounded-xl bg-[#e7edf5]">
                          <Thumb
                            src={product.images[0]?.url}
                            alt={product.images[0]?.altText ?? product.title}
                            className="size-full object-cover"
                            icon={<ShoppingBag className="size-4" />}
                          />
                        </div>
                        <p dir="auto" className="min-w-0 flex-1 truncate text-sm font-extrabold text-[#0a285a]">{product.title}</p>
                        <button
                          onClick={() => add.mutate({ listId, productId: product.id }, {
                            onSuccess: () => { void detail.refetch(); void utils.wishlists.wishedIds.invalidate(); toast.success(t("wish.added", { list: detail.data?.list.title ?? "" })); },
                            onError: error => toast.error(t(error.message as "wishlist.listFull")),
                          })}
                          disabled={already || add.isPending}
                          aria-label={already ? undefined : `${t("wish.add")}: ${product.title}`}
                          className={`pressable inline-flex h-9 shrink-0 items-center gap-1 rounded-full px-3 text-[12px] font-extrabold ${already ? "bg-[#d8ead8] text-[#2f5d33]" : "glass disabled:opacity-50"}`}
                        >
                          {already ? <Check className="size-3.5" aria-hidden /> : <Plus className="size-3.5" aria-hidden />}
                          {t(already ? "wish.onList" : "wish.add")}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div> : null}
          </>
        )}
      </QueryGate>
    </div>
  );
}

/** The item's photo, opening its page; a quiet box while it is read or once it has gone. */
function ItemPhoto({ product, href, waiting }: { product: Product | null; href: string | null; waiting: boolean }) {
  const box = "size-12 shrink-0 overflow-hidden rounded-xl bg-[#e7edf5]";
  if (!product || !href) {
    return <div aria-hidden className={`${box} grid place-items-center text-[#8a9bb4] ${waiting ? "animate-pulse" : ""}`}>{waiting ? null : <ShoppingBag className="size-4" />}</div>;
  }
  /* The title is the link a screen reader hears; the photo is the same page for a finger. */
  return (
    <Link href={href} tabIndex={-1} aria-hidden className={box}>
      <Thumb
        src={product.images[0]?.url}
        alt={product.images[0]?.altText ?? product.title}
        className="size-full object-cover"
        icon={<ShoppingBag className="size-4" />}
      />
    </Link>
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
    save.mutate({ listId, productId, note: value.trim() || null }, {
      /* Saved on leaving the box, so it says so — a field that saves with no
         word leaves somebody pressing around for a Save that is not there. */
      onSuccess: () => { onSaved(); toast.success(t("wish.savedToast")); },
      onError: error => toast.error(t(error.message as "wishlist.notFound")),
    });
  };

  return (
    <label className="mt-1 block">
      <span className="sr-only">{t("wish.noteLabel")}</span>
      <input
        value={value}
        onChange={event => setValue(event.target.value)}
        onBlur={commit}
        onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }}
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
        <span className="block text-[12px] font-semibold ink-muted">{t("wish.shownAs")}</span>
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
