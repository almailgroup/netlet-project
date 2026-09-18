/**
 * The gift side: somebody looking up a relative's list and buying from it.
 *
 * This is the only page in the storefront written for a visitor who is not a
 * shopper. They have a phone number and an occasion, they may never have heard
 * of NetLet, and they will not make an account to buy a present — so nothing
 * here requires one. The lookup, the list and the claim are all public; only
 * releasing a claim needs a session, because that one has to know it is you.
 *
 * Two pieces of honesty the page owes people:
 *
 * **"No published list for that number" never says why.** It cannot: the
 * server deliberately answers a number nobody has exactly as it answers a
 * number whose owner publishes nothing, so the lookup is not a way to ask who
 * shops here. The copy says what to do instead — ask them for the link —
 * rather than inventing a reason.
 *
 * **It says out loud that the owner cannot see who took what.** A giver
 * pressing "I will get this" is being asked to trust a stranger's website with
 * a surprise, and the one sentence that earns it is the one explaining the
 * system is built for that. It is also true: `itemsForOwner` does not select
 * the claim columns.
 */
import { MobileTabBar } from "@/components/MobileTabBar";
import { StoreHeader } from "@/components/StoreHeader";
import { Thumb } from "@/components/Thumb";
import { useCart } from "@/contexts/CartContext";
import { appPath } from "@/lib/basePath";
import { formatMoney } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { usePageMeta } from "@/lib/usePageMeta";
import { privatePageMeta } from "@shared/seo";
import { useTranslation } from "@/lib/useTranslation";
import { normalisePhone } from "@shared/commerce/wishlist";
import type { Product } from "@shared/commerce/types";
import { Check, Gift, Lock, Search, ShoppingBag } from "lucide-react";
import { useState } from "react";
import { useRoute } from "wouter";
import { toast } from "sonner";

export default function GiftList() {
  const { t, locale } = useTranslation();
  const [, params] = useRoute("/gifts/:token");
  const token = params?.token ?? null;

  usePageMeta(privatePageMeta(t("gift.title")));

  return (
    <div className="type-body min-h-dvh bg-background pb-24 lg:pb-0">
      <StoreHeader />
      <main id="main" className="container py-8 sm:py-12">
        <div className="mx-auto max-w-2xl">
          <div className="grid size-12 place-items-center rounded-2xl bg-[#e7edf5]">
            <Gift className="size-6 text-[#0a285a]" aria-hidden />
          </div>
          <h1 className="type-display mt-4 text-3xl text-[#0a285a] sm:text-4xl">{t("gift.heading")}</h1>
          <p className="mt-2 max-w-prose text-sm leading-6 ink-muted">{t("gift.intro")}</p>

          {token ? <ByToken token={token} locale={locale} /> : <Lookup locale={locale} />}
        </div>
      </main>
      <MobileTabBar />
    </div>
  );
}

/** A list reached from a pasted link. Not throttled — a token is not guessable. */
function ByToken({ token, locale }: { token: string; locale: "en" | "ar" }) {
  const { t } = useTranslation();
  const list = trpc.wishlists.byToken.useQuery({ token });

  if (list.isLoading) return null;
  return (
    <>
      {list.data
        ? <ListCard list={list.data} locale={locale} onChanged={() => void list.refetch()} />
        : <NotFound />}
      <a
        href={appPath("/gifts")}
        className="glass pressable mt-5 inline-flex rounded-full px-4 py-2 text-xs font-extrabold"
      >
        {t("gift.backToLookup")}
      </a>
    </>
  );
}

function Lookup({ locale }: { locale: "en" | "ar" }) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [asked, setAsked] = useState<string | null>(null);

  const valid = normalisePhone(value.trim()) !== null;
  const found = trpc.wishlists.findByPhone.useQuery({ phone: asked ?? "" }, { enabled: asked !== null, retry: false });

  return (
    <>
      <form
        className="mt-6 flex flex-wrap items-end gap-2"
        onSubmit={event => { event.preventDefault(); if (valid) setAsked(value.trim()); }}
      >
        <label className="min-w-0 flex-1">
          <span className="block text-[11px] font-extrabold tracking-[.1em] ink-muted uppercase">{t("gift.lookupLabel")}</span>
          <input
            value={value}
            onChange={event => setValue(event.target.value)}
            inputMode="tel"
            /* dir on a form control sets the typing direction — allowed. */
            dir="ltr"
            placeholder="5012 3456"
            className="glass-field mt-1 w-full rounded-full px-4 py-3 text-base"
          />
        </label>
        <button
          type="submit"
          disabled={!valid}
          className="glass glass-navy pressable inline-flex items-center gap-1.5 rounded-full px-5 py-3 text-xs font-extrabold disabled:opacity-60"
        >
          <Search className="size-4" aria-hidden />{t("gift.lookupSubmit")}
        </button>
      </form>

      {found.error ? (
        <p className="mt-6 rounded-2xl bg-[#fdeceb] p-4 text-sm text-[#8c2f22]">
          {t(found.error.message as "wishlist.tooManyLookups")}
        </p>
      ) : null}

      {asked !== null && found.data?.length === 0 ? <NotFound /> : null}

      {(found.data ?? []).map(list => (
        <ListCard key={list.token} list={list} locale={locale} onChanged={() => void found.refetch()} />
      ))}
    </>
  );
}

function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="mt-6 rounded-[1.35rem] border border-dashed border-[#c3ccda] bg-[#fbfaf6] p-6 text-center">
      <div className="mx-auto grid size-11 place-items-center rounded-2xl bg-[#e7edf5]">
        <Lock className="size-5 text-[#0a285a]" aria-hidden />
      </div>
      <p className="mt-3 text-sm font-extrabold text-[#0a285a]">{t("gift.none")}</p>
      {/* No reason given, because the server deliberately does not know one to
          give — see the file comment. What it offers instead is the next step. */}
      <p className="mx-auto mt-1 max-w-sm text-xs leading-5 ink-muted">{t("gift.noneNote")}</p>
    </div>
  );
}

type PublicList = {
  token: string;
  title: string;
  ownerName: string | null;
  items: {
    productId: string; note: string | null; quantity: number;
    state: "available" | "claimed" | "bought"; claimedByYou: boolean;
  }[];
};

function ListCard({ list, locale, onChanged }: { list: PublicList; locale: "en" | "ar"; onChanged: () => void }) {
  const { t } = useTranslation();
  const catalog = trpc.commerce.products.list.useQuery({ first: 100, locale });
  const byId = new Map((catalog.data ?? []).map(product => [product.id, product]));

  return (
    <section className="mt-6 rounded-[1.5rem] border border-[#d5dfeb] bg-white p-5 sm:p-7">
      <p className="text-[11px] font-extrabold tracking-[.12em] ink-accent uppercase">
        {list.ownerName ? t("gift.listOf", { name: list.ownerName }) : t("gift.listPlain")}
      </p>
      <h2 dir="auto" className="type-product mt-1 text-2xl text-[#0a285a]">{list.title}</h2>
      <p className="mt-2 flex items-center gap-1.5 text-xs ink-muted">
        <Lock className="size-3.5 shrink-0" aria-hidden />{t("gift.secret")}
      </p>

      {list.items.length === 0 ? (
        <p className="mt-5 text-sm ink-muted">{t("gift.emptyList")}</p>
      ) : (
        <ul className="mt-5 space-y-3">
          {list.items.map(item => (
            <GiftRow
              key={item.productId}
              item={item}
              product={byId.get(item.productId) ?? null}
              token={list.token}
              onChanged={onChanged}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function GiftRow({ item, product, token, onChanged }: {
  item: PublicList["items"][number];
  product: Product | null;
  token: string;
  onChanged: () => void;
}) {
  const { t, locale } = useTranslation();
  const { addItem } = useCart();
  const claim = trpc.wishlists.claim.useMutation();
  const release = trpc.wishlists.release.useMutation();

  const variant = product?.variants.find(v => v.availableForSale) ?? null;
  const price = variant?.price ?? product?.priceRange.min;
  const soldOut = product !== null && variant === null;
  const taken = item.state !== "available";

  /*
   * Claiming and bagging are one press, because they are one intention. Two
   * buttons would let somebody put the gift in their bag without marking it,
   * and the next relative would buy it too — which is the single failure this
   * whole mechanic exists to prevent.
   */
  const take = () => {
    if (!variant) return;
    claim.mutate({ token, productId: item.productId }, {
      onSuccess: () => {
        // Deliberately without the drawer: a relative is usually choosing
        // several presents from one list, and popping the whole bag between
        // each would mean dismissing it to get back to what they were reading.
        // The toast is the confirmation here.
        void addItem(variant.id, item.quantity, false);
        onChanged();
        toast.success(t("gift.claimed_toast"));
      },
      onError: error => {
        // Somebody got there first between the page loading and the press.
        onChanged();
        toast.error(t(error.message as "wishlist.alreadyClaimed"));
      },
    });
  };

  return (
    <li className="flex items-center gap-3 rounded-2xl border border-[#e7edf5] p-3">
      <a
        href={product ? appPath(`/products/${encodeURIComponent(product.handle)}`) : "#"}
        className="size-16 shrink-0 overflow-hidden rounded-xl bg-[#e7edf5]"
      >
        <Thumb
          src={product?.images[0]?.url}
          alt={product?.images[0]?.altText ?? product?.title ?? ""}
          className="size-full object-cover"
          icon={<ShoppingBag className="size-5" />}
        />
      </a>

      <div className="min-w-0 flex-1">
        <p dir="auto" className="truncate text-sm font-extrabold text-[#0a285a]">{product?.title ?? item.productId}</p>
        {item.note ? <p dir="auto" className="truncate text-xs ink-muted">{item.note}</p> : null}
        {price ? <p className="mt-0.5 text-sm font-extrabold text-[#0a285a]">{formatMoney(price, { locale })}</p> : null}
      </div>

      {/* Text, then colour. A row of grey pills tells a colour-blind visitor
          nothing; every state here carries its own words. */}
      {item.state === "bought" ? (
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#e7edf5] px-3 py-2 text-[11px] font-extrabold text-[#536b8c]">
          <Check className="size-3.5" aria-hidden />{t("gift.bought")}
        </span>
      ) : item.claimedByYou ? (
        /*
         * The one claim fact the server will tell a viewer is whether *they*
         * hold it — a fact about them, never about Salem. It is what makes the
         * release endpoint reachable at all; without it there would be a
         * procedure nobody could call.
         */
        <button
          onClick={() => release.mutate({ token, productId: item.productId }, {
            onSuccess: () => { onChanged(); toast.success(t("gift.released")); },
          })}
          disabled={release.isPending}
          className="glass pressable inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2.5 text-[11px] font-extrabold disabled:opacity-60"
        >
          <Check className="size-3.5" aria-hidden />{t("gift.release")}
        </button>
      ) : item.state === "claimed" ? (
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#e7edf5] px-3 py-2 text-[11px] font-extrabold text-[#536b8c]">
          <Check className="size-3.5" aria-hidden />{t("gift.claimed")}
        </span>
      ) : soldOut ? (
        <span className="shrink-0 rounded-full bg-[#e7edf5] px-3 py-2 text-[11px] font-extrabold text-[#536b8c]">
          {t("gift.soldOut")}
        </span>
      ) : (
        <button
          onClick={take}
          disabled={taken || !variant || claim.isPending}
          className="glass glass-navy pressable inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2.5 text-[11px] font-extrabold disabled:opacity-60"
        >
          <Gift className="size-3.5" aria-hidden />{t("gift.claim")}
        </button>
      )}
    </li>
  );
}
