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
 * **"No published list for that number or name" never says why.** It
 * cannot: the server deliberately answers a number nobody has exactly as it
 * answers a number whose owner publishes nothing, and a name the same way, so the lookup is not a way to ask who
 * shops here. The copy says what to do instead — ask them for the link —
 * rather than inventing a reason.
 *
 * **It says out loud that the owner cannot see who took what.** A giver
 * pressing "I will get this" is being asked to trust a stranger's website with
 * a surprise, and the one sentence that earns it is the one explaining the
 * system is built for that. It is also true: `itemsForOwner` does not select
 * the claim columns.
 *
 * And three things it does so the present that arrives is the one wanted:
 * **a product with sizes or colours asks which** before it is claimed — it
 * used to put the first in stock in the bag, so a shirt wished for in M went
 * out in S — with the owner's note right above the choice; **a claim made
 * here is "yours"**, signed in or not (`giftClaims.ts`), where a guest used
 * to be told "Someone is getting this" over the thing they had just taken;
 * and **products are read by id**, so a list holding something older than
 * the newest hundred is not a row of numbers nobody can buy.
 */
import { CARD, PageBody, PageHeading } from "@/components/layout/Page";
import { useFeature } from "@/hooks/useFeature";
import { useAuth } from "@/hooks/useAuth";
import { useProductsByIds } from "@/hooks/useCatalog";
import { Thumb } from "@/components/product/Thumb";
import { Select } from "@/components/ui/Select";
import { useCart } from "@/contexts/CartContext";
import { claimedHere, rememberClaim } from "@/lib/giftClaims";
import { trpc } from "@/lib/trpc";
import { usePageMeta } from "@/hooks/usePageMeta";
import { privatePageMeta } from "@shared/seo";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { isMessageKey } from "@shared/i18n/dictionary";
import {
  cleanGiverName,
  GIVER_NAME_MAX,
  giftLookup,
  giverNameProblem,
  suggestedGiverName,
  type GiftLookup,
  type GiverNameProblem,
} from "@shared/commerce/wishlist";
import { isolate } from "@/lib/isolate";
import type { Product } from "@shared/commerce/types";
import { AlertTriangle, Check, EyeOff, Gift, Lock, RotateCw, Search, ShoppingBag, UserRound } from "lucide-react";
import { useId, useState } from "react";
import { Link, useRoute } from "wouter";
import { toast } from "sonner";
import { failedToLoad } from "@/lib/queryState";

export default function GiftList() {
  const { t } = useTranslation();
  const [, params] = useRoute("/gifts/:token");
  const token = params?.token ?? null;
  /* Switched off (2.3): the public half of gift lists closes — the phone
     lookup first among it — and the page says so rather than erroring. */
  const on = useFeature("wishlists");

  usePageMeta(privatePageMeta(t("gift.title")));

  return (
    <PageBody width="reading">
      <div className="type-body max-w-2xl">
        <PageHeading title={t("gift.heading")} note={t("gift.intro")} />
        {!on
          ? <p className={`${CARD} px-5 py-6 text-sm ink-muted`}>{t("gift.switchedOff")}</p>
          : token ? <ByToken key={token} token={token} /> : <Lookup />}
      </div>
    </PageBody>
  );
}

/** A list reached from a pasted link. Not throttled — a token is not guessable. */
function ByToken({ token }: { token: string }) {
  const { t } = useTranslation();
  const list = trpc.wishlists.byToken.useQuery({ token }, { refetchOnWindowFocus: false });

  return (
    <>
      {list.isLoading ? <ListSkeleton />
        : failedToLoad(list) ? <LoadFailed onRetry={() => void list.refetch()} />
        : list.data ? <ListCard list={list.data} onChanged={() => void list.refetch()} />
        : <NotFound byLink />}
      <Link
        href="/gifts"
        className="glass pressable mt-5 inline-flex rounded-full px-4 py-2 text-xs font-extrabold"
      >
        {t("gift.backToLookup")}
      </Link>
    </>
  );
}

/**
 * Finding somebody's public list by their number or the name on it — the
 * `/gifts` page's form, and the same form inside the account's Wishlists and
 * gifts, on the owner's word ("finding a user for buying their wishlist
 * should be in Wishlist and gifts itself").
 */
export function GiftFinder() {
  return <Lookup />;
}

function Lookup() {
  const { t } = useTranslation();
  const fieldId = useId();
  const [value, setValue] = useState("");
  const [asked, setAsked] = useState<GiftLookup | null>(null);
  const [invalid, setInvalid] = useState(false);

  /*
   * Every lookup counts against the address's hourly ceiling, by number or by
   * name alike, so it is asked only when somebody presses Find — never again
   * because the window took focus, which spent one each time a giver came
   * back from their messages with the number.
   */
  const once = { retry: false, refetchOnWindowFocus: false, staleTime: 60_000 } as const;
  const byPhone = trpc.wishlists.findByPhone.useQuery(
    { phone: asked && "phone" in asked ? asked.phone : "" },
    { ...once, enabled: asked !== null && "phone" in asked },
  );
  const byName = trpc.wishlists.findByName.useQuery(
    { name: asked && "name" in asked ? asked.name : "" },
    { ...once, enabled: asked !== null && "name" in asked },
  );
  const found = asked && "name" in asked ? byName : byPhone;
  /* A refusal we wrote — the ceiling, or a number the server cannot key — is
     said as it is; anything else is a read that failed. */
  const message = found.error?.message;
  const refusal = message && isMessageKey(message) ? message : null;

  return (
    <>
      <form
        className="flex flex-wrap items-end gap-2"
        noValidate
        onSubmit={event => {
          event.preventDefault();
          const query = giftLookup(value);
          if (query === null) {
            /* Said, not greyed out: a disabled Find with no sentence beside it
               leaves somebody guessing what the field wants. */
            setInvalid(true);
            document.getElementById(fieldId)?.focus();
            return;
          }
          setInvalid(false);
          setAsked(query);
        }}
      >
        <label className="min-w-0 flex-1" htmlFor={fieldId}>
          <span className="block text-[12px] font-semibold ink-muted">{t("gift.lookupLabel")}</span>
          <input
            id={fieldId}
            value={value}
            onChange={event => { setValue(event.target.value); if (invalid) setInvalid(false); }}
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            /* A number types left to right and a name in its own language, so
               the box follows what is typed. */
            dir="auto"
            placeholder={t("gift.lookupPlaceholder")}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? `${fieldId}-error` : undefined}
            className="glass-field mt-1 w-full rounded-full px-4 py-3 text-base"
          />
        </label>
        <button
          type="submit"
          className="glass glass-navy pressable inline-flex h-12 items-center gap-1.5 rounded-full px-5 text-xs font-extrabold"
        >
          <Search className="size-4" aria-hidden />{t("gift.lookupSubmit")}
        </button>
      </form>
      {invalid ? (
        <p id={`${fieldId}-error`} className="mt-2 text-xs font-semibold text-[#8c2f22]">{t("gift.lookupInvalid")}</p>
      ) : null}

      {asked === null ? null
        : found.isLoading ? <ListSkeleton />
        : refusal ? (
          <p role="alert" className="mt-6 rounded-2xl bg-[#fdeceb] p-4 text-sm text-[#8c2f22]">{t(refusal)}</p>
        ) : failedToLoad(found) ? <LoadFailed onRetry={() => void found.refetch()} />
        : found.data?.length === 0 ? <NotFound />
        : (found.data ?? []).map(list => (
          <ListCard key={list.token} list={list} onChanged={() => void found.refetch()} />
        ))}
    </>
  );
}

/** Nothing to show. From a link the words are about the link, which the
    person holding it used: "that number" and "ask for the link" were about a
    lookup they never made. */
function NotFound({ byLink = false }: { byLink?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="mt-6 rounded-[1.35rem] border border-dashed border-[#c3ccda] bg-[#fbfaf6] p-6 text-center">
      <div className="mx-auto grid size-11 place-items-center rounded-2xl bg-[#e7edf5]">
        <Lock className="size-5 text-[#0a285a]" aria-hidden />
      </div>
      <p className="mt-3 text-sm font-extrabold text-[#0a285a]">{t(byLink ? "gift.linkGone" : "gift.none")}</p>
      {/* No reason given, because the server deliberately does not know one to
          give — see the file comment. What it offers instead is the next step. */}
      <p className="mx-auto mt-1 max-w-sm text-xs leading-5 ink-muted">{t(byLink ? "gift.linkGoneNote" : "gift.noneNote")}</p>
    </div>
  );
}

/** A read that did not come back is said, with a retry — never drawn as "no list". */
function LoadFailed({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div role="alert" className="mt-6 rounded-2xl border border-[#f2b69e] bg-[#fdeceb] p-5">
      <p className="flex items-center gap-2 text-sm font-bold text-[#8c2f22]">
        <AlertTriangle className="size-4 shrink-0" aria-hidden />{t("gift.loadFailed")}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 inline-flex h-10 items-center gap-2 rounded-full border border-[#efc6bd] bg-white px-4 text-[13px] font-semibold text-[#8c2f22] hover:bg-[#fff5f3]"
      >
        <RotateCw className="size-4" aria-hidden />{t("admin.retry")}
      </button>
    </div>
  );
}

/** The shape of a list while it loads, so the page does not jump when it lands. */
function ListSkeleton() {
  const { t } = useTranslation();
  return (
    <div role="status" className="mt-6 rounded-[1.5rem] border border-[#d5dfeb] bg-white p-5 sm:p-7">
      <span className="sr-only">{t("admin.loading")}</span>
      <div aria-hidden className="h-4 w-28 animate-pulse rounded bg-[#e7edf5]" />
      <div aria-hidden className="mt-3 h-7 w-56 max-w-full animate-pulse rounded bg-[#e7edf5]" />
      <div aria-hidden className="mt-6 space-y-3">
        {[0, 1, 2].map(index => <div key={index} className="h-[5.5rem] animate-pulse rounded-2xl bg-[#f3f5f9]" />)}
      </div>
    </div>
  );
}

type PublicList = {
  token: string;
  title: string;
  ownerName: string | null;
  /** Whether a giver may say who a gift is from (migration 0092 pasted). */
  namesOpen?: boolean;
  items: {
    productId: string; note: string | null; quantity: number;
    state: "available" | "claimed" | "bought"; claimedByYou: boolean;
    /** What this viewer said their gift is from; null is anonymous. */
    yourName?: string | null;
  }[];
};

/**
 * What a claim pressed on this page says it is from: the name to show, or
 * null to stay anonymous — or false when the name typed cannot be shown, in
 * which case the box has said why and taken focus, and nothing is claimed.
 */
type GiverFor = () => { shownAs: string | null } | false;

function ListCard({ list, onChanged }: { list: PublicList; onChanged: () => void }) {
  const { t } = useTranslation();
  const { isAuthenticated, user } = useAuth();
  const products = useProductsByIds(list.items.map(item => item.productId));
  const anyOpen = list.items.some(item => item.state === "available");
  const namesOpen = list.namesOpen === true;

  /*
   * Who a gift is from, the giver's choice, on the owner's word (migration
   * 0092): a name they type, shown to the list's owner once the gift arrives,
   * or anonymous ("From someone"). Public is chosen to start, the account's
   * first name in the box; a giver who is not signed in is anonymous. One
   * choice for the page, applied to every claim pressed on it.
   */
  const [mode, setMode] = useState<"name" | "anonymous">("name");
  const [typed, setTyped] = useState<string | null>(null);
  const [nameProblem, setNameProblem] = useState<GiverNameProblem | null>(null);
  const nameId = useId();
  const shownName = typed ?? suggestedGiverName(user?.name);
  const giverFor: GiverFor = () => {
    if (!namesOpen || !isAuthenticated || mode === "anonymous") return { shownAs: null };
    const problem = giverNameProblem(shownName);
    if (problem) {
      setNameProblem(problem);
      const box = document.getElementById(nameId);
      box?.focus();
      box?.scrollIntoView({ block: "center", behavior: "smooth" });
      return false;
    }
    setNameProblem(null);
    return { shownAs: cleanGiverName(shownName) };
  };

  return (
    <section className="mt-6 rounded-[1.5rem] border border-[#d5dfeb] bg-white p-5 sm:p-7">
      <p className="text-[12px] font-semibold ink-accent">
        {list.ownerName ? t("gift.listOf", { name: list.ownerName }) : t("gift.listPlain")}
      </p>
      <h2 dir="auto" className="type-product mt-1 text-2xl text-[#0a285a]">{list.title}</h2>
      <p className="mt-2 flex items-start gap-1.5 text-xs leading-5 ink-muted">
        <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />{t(namesOpen ? "gift.secretUntilArrival" : "gift.secret")}
      </p>
      {/* Said before the press, not after: a claim made signed out cannot be
          let go (the server cannot tell it is yours), only waited out. */}
      {!isAuthenticated && anyOpen ? (
        <p className="mt-1 text-xs leading-5 ink-muted">{t("gift.signInToRelease")}</p>
      ) : null}

      {namesOpen && anyOpen ? (
        <GiverChoice
          token={list.token}
          ownerName={list.ownerName}
          signedIn={isAuthenticated}
          mode={mode}
          onMode={next => { setMode(next); setNameProblem(null); }}
          name={shownName}
          onName={value => { setTyped(value); if (nameProblem) setNameProblem(giverNameProblem(value)); }}
          nameId={nameId}
          problem={nameProblem}
        />
      ) : null}

      {list.items.length === 0 ? (
        <p className="mt-5 text-sm ink-muted">{t("gift.emptyList")}</p>
      ) : failedToLoad(products.query) ? (
        <LoadFailed onRetry={() => void products.query.refetch()} />
      ) : (
        <ul className="mt-5 space-y-3">
          {list.items.map(item => (
            <GiftRow
              key={item.productId}
              item={item}
              product={products.byId.get(item.productId) ?? null}
              waiting={!products.settled && !products.byId.has(item.productId)}
              token={list.token}
              signedIn={isAuthenticated}
              namesOpen={namesOpen}
              giverFor={giverFor}
              onChanged={onChanged}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * "Who is it from?" — Show my name, with the name to show, or Stay anonymous.
 * Two real radios in a named group, so the arrow keys move between them; a
 * signed-out giver is told they stay anonymous and offered the sign-in, which
 * comes back to this list.
 */
function GiverChoice({ token, ownerName, signedIn, mode, onMode, name, onName, nameId, problem }: {
  token: string;
  ownerName: string | null;
  signedIn: boolean;
  mode: "name" | "anonymous";
  onMode: (mode: "name" | "anonymous") => void;
  name: string;
  onName: (value: string) => void;
  nameId: string;
  problem: GiverNameProblem | null;
}) {
  const { t } = useTranslation();
  const groupName = useId();
  const intro = ownerName ? t("gift.fromIntroNamed", { name: isolate(ownerName) }) : t("gift.fromIntro");
  const choices = [
    { value: "name" as const, label: t("gift.fromName"), note: t("gift.fromNameNote"), Icon: UserRound },
    { value: "anonymous" as const, label: t("gift.fromAnonymous"), note: t("gift.fromAnonymousNote"), Icon: EyeOff },
  ];

  return (
    <div className="mt-4 rounded-2xl border border-[#e7edf5] bg-[#f7f9fc] p-4">
      <fieldset>
        <legend className="text-sm font-extrabold text-[#0a285a]">{t("gift.fromTitle")}</legend>
        <p className="mt-1 text-xs leading-5 ink-muted">{intro}</p>
        {signedIn ? (
          <>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {choices.map(({ value, label, note, Icon }) => {
                const chosen = mode === value;
                return (
                  <label
                    key={value}
                    className={`flex cursor-pointer items-start gap-2.5 rounded-2xl border bg-white p-3 ${chosen ? "border-[#0a285a] shadow-[inset_0_0_0_1px_#0a285a]" : "border-[#d5dfeb] hover:bg-[#f0f2f5]"}`}
                  >
                    <input
                      type="radio"
                      name={groupName}
                      value={value}
                      checked={chosen}
                      onChange={() => onMode(value)}
                      className="mt-0.5 size-4 shrink-0 accent-[#0a285a]"
                    />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 text-[13px] font-extrabold text-[#0a285a]">
                        <Icon className="size-3.5 shrink-0" aria-hidden />{label}
                      </span>
                      <span className="mt-0.5 block text-xs leading-5 ink-muted">{note}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            {mode === "name" ? (
              <>
                <label htmlFor={nameId} className="mt-3 block">
                  <span className="block text-[12px] font-semibold ink-muted">{t("gift.fromNameLabel")}</span>
                  <input
                    id={nameId}
                    value={name}
                    onChange={event => onName(event.target.value)}
                    /* A name types in its own language. */
                    dir="auto"
                    autoComplete="nickname"
                    maxLength={GIVER_NAME_MAX * 2}
                    aria-invalid={problem ? true : undefined}
                    aria-describedby={problem ? `${nameId}-error` : undefined}
                    className="glass-field mt-1 w-full rounded-full px-4 py-3 text-base"
                  />
                </label>
                {problem ? (
                  <p id={`${nameId}-error`} className="mt-1.5 text-xs font-semibold text-[#8c2f22]">{t(`wishlist.${problem}`)}</p>
                ) : null}
              </>
            ) : null}
          </>
        ) : (
          <>
            <p className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-[#2b3a55]">
              <EyeOff className="mt-0.5 size-3.5 shrink-0" aria-hidden />{t("gift.fromSignedOut")}
            </p>
            <Link
              href={`/signin?next=${encodeURIComponent(`/gifts/${token}`)}`}
              className="mt-2 inline-flex min-h-10 items-center rounded-full border border-[#d5dfeb] bg-white px-4 text-[12px] font-extrabold text-[#0a285a] hover:bg-[#f0f2f5]"
            >
              {t("gift.fromSignIn")}
            </Link>
          </>
        )}
      </fieldset>
    </div>
  );
}

/** A variant as a giver chooses it: its option values, or its name. */
function variantLabel(variant: Product["variants"][number]) {
  const values = variant.selectedOptions.map(option => option.value).filter(Boolean);
  return values.length ? values.join(" · ") : variant.title;
}

function GiftRow({ item, product, waiting, token, signedIn, namesOpen, giverFor, onChanged }: {
  item: PublicList["items"][number];
  product: Product | null;
  /** Its product has not been read yet, so nothing about it is known. */
  waiting: boolean;
  token: string;
  signedIn: boolean;
  namesOpen: boolean;
  giverFor: GiverFor;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const money = useMoney();
  const { addItem } = useCart();
  const claim = trpc.wishlists.claim.useMutation();
  const release = trpc.wishlists.release.useMutation();
  const selectId = useId();
  const [chosenId, setChosenId] = useState("");
  const [askChoice, setAskChoice] = useState(false);
  /* Taken on this page a moment ago, before the list has been read again. */
  const [took, setTook] = useState(false);

  const buyable = product?.variants.filter(variant => variant.availableForSale) ?? [];
  /* More than one variant is a size or a colour to choose before a claim
     means anything — the product page's rule. */
  const choosing = (product?.variants.length ?? 0) > 1 && buyable.length > 0;
  const variant = choosing ? buyable.find(entry => entry.id === chosenId) ?? null : buyable[0] ?? null;
  const price = variant?.price ?? product?.priceRange.min;
  const soldOut = product !== null && buyable.length === 0;
  const gone = product === null && !waiting;
  /* Yours: the server says so for a signed-in giver; a guest's own device
     remembers what it claimed. */
  const yours = item.state !== "bought" && (item.claimedByYou || took || (item.state === "claimed" && claimedHere(token, item.productId)));

  /*
   * Claiming and bagging are one press, because they are one intention. Two
   * buttons would let somebody put the gift in their bag without marking it,
   * and the next relative would buy it too — which is the single failure this
   * whole mechanic exists to prevent.
   */
  const take = () => {
    if (!variant) {
      if (choosing) {
        setAskChoice(true);
        document.getElementById(selectId)?.focus();
      }
      return;
    }
    const giver = giverFor();
    if (giver === false) return;
    claim.mutate({ token, productId: item.productId, shownAs: giver.shownAs }, {
      onSuccess: () => {
        if (!signedIn) rememberClaim(token, item.productId);
        setTook(true);
        // Deliberately without the drawer: a relative is usually choosing
        // several presents from one list, and popping the whole bag between
        // each would mean dismissing it to get back to what they were reading.
        // The toast is the confirmation here.
        addItem(variant.id, item.quantity, { reveal: false, ...(product ? { product } : {}) }).catch(() => toast.error(t("cart.addFailed")));
        onChanged();
        toast.success(t("gift.claimed_toast"));
      },
      onError: error => {
        // Somebody got there first between the page loading and the press.
        onChanged();
        toast.error(isMessageKey(error.message) ? t(error.message) : t("gift.loadFailed"));
      },
    });
  };

  const href = product ? `/products/${encodeURIComponent(product.handle)}` : null;
  const title = product?.title ?? (waiting ? "" : t("product.unavailable"));

  return (
    <li className="flex gap-3 rounded-2xl border border-[#e7edf5] p-3">
      {href ? (
        /* The title is the link a screen reader hears; the photo opens the
           same page for a finger — the product card's rule. */
        <Link href={href} tabIndex={-1} aria-hidden className="size-16 shrink-0 overflow-hidden rounded-xl bg-[#e7edf5]">
          <Thumb
            src={product?.images[0]?.url}
            alt={product?.images[0]?.altText ?? product?.title ?? ""}
            className="size-full bg-white object-contain"
            icon={<ShoppingBag className="size-5" />}
          />
        </Link>
      ) : (
        <div aria-hidden className={`grid size-16 shrink-0 place-items-center rounded-xl bg-[#e7edf5] text-[#8a9bb4] ${waiting ? "animate-pulse" : ""}`}>
          {waiting ? null : <ShoppingBag className="size-5" />}
        </div>
      )}

      <div className="min-w-0 flex-1">
        {waiting ? (
          <div aria-hidden className="mt-1 h-4 w-40 max-w-full animate-pulse rounded bg-[#e7edf5]" />
        ) : href ? (
          <Link href={href} dir="auto" className="line-clamp-2 text-sm font-extrabold text-[#0a285a] hover:text-[#a44a2b]">{title}</Link>
        ) : (
          <p className="text-sm font-extrabold ink-muted">{title}</p>
        )}
        {/* The owner's note in full, never cut: "the blue one, size 42" is
            what the choice below is made by. */}
        {item.note ? <p dir="auto" className="mt-0.5 text-xs leading-5 text-[#2b3a55]">{item.note}</p> : null}
        {price ? <p className="mt-0.5 text-sm font-extrabold text-[#0a285a]">{money(price)}</p> : null}

        {/* Text, then colour. A row of grey pills tells a colour-blind visitor
            nothing; every state here carries its own words. */}
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {item.state === "bought" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e7edf5] px-3 py-2 text-[12px] font-extrabold text-[#536b8c]">
              <Check className="size-3.5" aria-hidden />{t("gift.bought")}
            </span>
          ) : yours ? (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#d8ead8] px-3 py-2 text-[12px] font-extrabold text-[#2f5d33]">
                <Check className="size-3.5" aria-hidden />{t("gift.yours")}
              </span>
              <Link href="/cart" className="rounded-full px-2 py-2 text-[12px] font-extrabold text-[#0a285a] underline underline-offset-2">
                {t("cart.title")}
              </Link>
              {/*
               * The one claim fact the server will tell a viewer is whether
               * *they* hold it — a fact about them, never about Salem. It is
               * what makes the release endpoint reachable at all.
               */}
              {item.claimedByYou ? (
                <button
                  type="button"
                  onClick={() => release.mutate({ token, productId: item.productId }, {
                    onSuccess: () => { setTook(false); onChanged(); toast.success(t("gift.released")); },
                    onError: error => toast.error(isMessageKey(error.message) ? t(error.message) : t("gift.loadFailed")),
                  })}
                  disabled={release.isPending}
                  className="rounded-full px-2 py-2 text-[12px] font-extrabold ink-muted underline underline-offset-2 disabled:opacity-60"
                >
                  {t("gift.release")}
                </button>
              ) : null}
            </>
          ) : item.state === "claimed" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e7edf5] px-3 py-2 text-[12px] font-extrabold text-[#536b8c]">
              <Check className="size-3.5" aria-hidden />{t("gift.claimed")}
            </span>
          ) : waiting ? null : gone ? (
            <span className="rounded-full bg-[#e7edf5] px-3 py-2 text-[12px] font-extrabold text-[#536b8c]">{t("product.unavailable")}</span>
          ) : soldOut ? (
            <span className="rounded-full bg-[#e7edf5] px-3 py-2 text-[12px] font-extrabold text-[#536b8c]">
              {t("gift.soldOut")}
            </span>
          ) : (
            <>
              {choosing && product ? (
                <Select
                  id={selectId}
                  value={chosenId}
                  onChange={event => { setChosenId(event.target.value); setAskChoice(false); }}
                  aria-label={`${t("product.chooseOption")}: ${product.title}`}
                  aria-invalid={askChoice || undefined}
                  aria-describedby={askChoice ? `${selectId}-error` : undefined}
                  className="h-10 min-w-[9rem] max-w-full rounded-full border border-[#d5dfeb] bg-white px-4 text-[13px] font-semibold text-[#0a285a]"
                >
                  <option value="" disabled>{t("product.chooseOption")}</option>
                  {product.variants.map(entry => (
                    <option key={entry.id} value={entry.id} disabled={!entry.availableForSale}>
                      {entry.availableForSale ? variantLabel(entry) : `${variantLabel(entry)} — ${t("gift.soldOut")}`}
                    </option>
                  ))}
                </Select>
              ) : null}
              <button
                type="button"
                onClick={take}
                disabled={claim.isPending}
                className="glass glass-navy pressable inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-[12px] font-extrabold disabled:opacity-60"
              >
                <Gift className="size-3.5" aria-hidden />{t("gift.claim")}
              </button>
            </>
          )}
        </div>
        {/* Who the giver said it is from, a fact about them alone. */}
        {yours && namesOpen ? (
          <p className="mt-1.5 flex items-center gap-1.5 text-xs leading-5 ink-muted">
            {item.yourName ? <UserRound className="size-3.5 shrink-0" aria-hidden /> : <EyeOff className="size-3.5 shrink-0" aria-hidden />}
            {item.claimedByYou && item.yourName
              ? t("gift.yourFromName", { name: isolate(item.yourName) })
              : t("gift.yourFromAnonymous")}
          </p>
        ) : null}
        {askChoice && !variant ? (
          <p id={`${selectId}-error`} className="mt-1.5 text-xs font-semibold text-[#8c2f22]">{t("gift.chooseFirst")}</p>
        ) : null}
      </div>
    </li>
  );
}
