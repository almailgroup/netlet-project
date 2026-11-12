/**
 * One of NetLet's occasions — `/admin/occasions/new` and
 * `/admin/occasions/:id`.
 *
 * Its two names, its address, a banner picture, the days it runs and the
 * products chosen for it, in the order they are shown. Nothing is kept until
 * Save and nothing reaches a shopper until Publish. `occasionProblems` is the
 * rule the server asks again, so a problem is said under its own box when
 * Save is pressed and leaves when it is fixed.
 *
 * Opened from "Customise" on one of the calendar's occasions
 * (`?from=winter`) it starts as that occasion — its address, the
 * dictionary's two names, the calendar's own dates — and is still nothing
 * until it is saved: backing out leaves no draft behind.
 *
 * The picture is cropped to 3:1 in the browser (`prepareBanner`, the home
 * banners' own) and uploaded like any photo, so the preview is what the home
 * page draws.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ImagePlus, LoaderCircle, Plus, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useLocation, useRoute } from "wouter";
import { AdminShell } from "@/components/admin/AdminShell";
import { QueryGate } from "@/components/admin/QueryGate";
import { BackLink, buttonClass, Card, Field, fieldClass, Notice, PageHeader, Pill, smallButtonClass, Toggle } from "@/components/admin/ui";
import { Thumb } from "@/components/product/Thumb";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { MIN_SHELF_PRODUCTS } from "@/content/homeLayout";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/hooks/useTranslation";
import { shopHref } from "@/lib/portalHost";
import { prepareBanner } from "@/lib/prepareBanner";
import { trpc } from "@/lib/trpc";
import {
  MAX_OCCASION_PRODUCTS,
  OCCASION_FIELDS,
  OCCASION_SLUG_MAX,
  OCCASION_TITLE_MAX,
  isCalendarSlug,
  occasionProblems,
  occasionSlug,
  type OccasionContent,
  type OccasionField,
  type OccasionProblems,
  type OccasionStatus,
} from "@shared/commerce/occasionDesk";
import { foldTag, occasionFromSlug } from "@shared/commerce/occasions";
import { ar, en } from "@shared/i18n/dictionary";
import { privatePageMeta } from "@shared/seo";
import { STATUS_LABEL, STATUS_TONE, SeasonPill } from "./Occasions";
import { useConfirmRemoval } from "@/components/ui/ConfirmRemoval";

/** A product chosen for the occasion, as the list draws it. */
type Chosen = { id: number; title: string; titleAr: string | null; vendorName: string | null; imageUrl: string | null; live: boolean };

const EMPTY: OccasionContent = { slug: "", title: "", titleAr: "", imageUrl: null, startsOn: null, endsOn: null, includeTagged: true };

export default function AdminOccasionEditor() {
  usePageMeta(privatePageMeta("Occasion"));
  const [, params] = useRoute("/admin/occasions/:id");
  const raw = params?.id ?? "new";
  const id = raw === "new" ? null : Number(raw);
  return <AdminShell need="platform.configure">{() => (id === null ? <Fresh /> : <Existing key={id} id={id} />)}</AdminShell>;
}

/** A new one: empty, or one of the calendar's occasions to take over. */
function Fresh() {
  const from = occasionFromSlug(new URLSearchParams(window.location.search).get("from"));
  const initial: OccasionContent = from ? { ...EMPTY, slug: from.slug, title: en[from.label], titleAr: ar[from.label] } : EMPTY;
  return <Editor key={from?.slug ?? "new"} id={null} initial={initial} products={[]} status="draft" taking={Boolean(from)} />;
}

function Existing({ id }: { id: number }) {
  const { t } = useTranslation();
  const valid = Number.isInteger(id) && id > 0;
  const occasion = trpc.occasions.get.useQuery({ id }, { enabled: valid, retry: false });
  /* No such occasion — deleted, or a typed address: said with a heading and the way back. */
  if (!valid || occasion.error?.data?.code === "NOT_FOUND") return (
    <>
      <BackLink href="/admin/occasions">{t("occasions.back")}</BackLink>
      <PageHeader title={t("occasions.notFound")} />
    </>
  );
  return (
    <QueryGate queries={[occasion]}>
      {() => {
        const row = occasion.data!;
        const { slug, title, titleAr, imageUrl, startsOn, endsOn, includeTagged } = row;
        return (
          <Editor
            id={id}
            initial={{ slug, title, titleAr, imageUrl, startsOn, endsOn, includeTagged }}
            products={row.products}
            status={row.status}
            taking={false}
            season={<SeasonPill season={row.season} startsOn={row.startsOn} endsOn={row.endsOn} />}
            tagged={row.tagged}
          />
        );
      }}
    </QueryGate>
  );
}

function Editor({ id, initial, products, status, taking, season, tagged = 0 }: {
  id: number | null;
  initial: OccasionContent;
  products: Chosen[];
  status: OccasionStatus;
  /** Opened from one of the calendar's occasions, whose address it keeps. */
  taking: boolean;
  season?: ReactNode;
  /** Products the stores tagged for it that the shop shows, beyond the chosen. */
  tagged?: number;
}) {
  const { t, tError, isArabic } = useTranslation();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [content, setContent] = useState<OccasionContent>(initial);
  const [chosen, setChosen] = useState<Chosen[]>(products);
  /* The calendar's own days, for an occasion the calendar knows; off as soon as it is given days of its own. */
  const [follow, setFollow] = useState(isCalendarSlug(initial.slug) && !initial.startsOn && !initial.endsOn);
  /* The address follows the English name until somebody types one. */
  const [slugTyped, setSlugTyped] = useState(Boolean(initial.slug));
  const [tried, setTried] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const snapshot = (next: OccasionContent, list: Chosen[], following: boolean) => JSON.stringify([next, list.map(one => one.id), following]);
  const [saved, setSaved] = useState(() => snapshot(initial, products, follow));

  const calendar = isCalendarSlug(content.slug);
  const following = calendar && follow;
  /* What Save sends: an occasion following the calendar has no days of its own. */
  const sending: OccasionContent = useMemo(
    () => ({ ...content, startsOn: following ? null : content.startsOn || null, endsOn: following ? null : content.endsOn || null }),
    [content, following],
  );
  const problems: OccasionProblems = useMemo(() => {
    const found = occasionProblems(sending);
    /* Told not to follow the calendar and given no days: the rule would take that as following it. */
    if (calendar && !following && !sending.startsOn && !sending.endsOn) found.startsOn = "occasions.needDates";
    return found;
  }, [sending, calendar, following]);
  const dirty = snapshot(content, chosen, follow) !== saved;
  /* Once public, the address is what a shared link holds; taking a calendar occasion over keeps its own. */
  const slugLocked = status !== "draft" || taking;

  const refresh = () => Promise.all([utils.occasions.list.invalidate(), id ? utils.occasions.get.invalidate({ id }) : undefined, utils.occasions.live.invalidate()]);
  const fail = (message: string) => {
    /* The one refusal only the server can make that belongs to a box. */
    if (message === "occasions.slugTaken") document.getElementById("occasion-slug")?.focus();
    toast.error(tError(message));
  };

  const save = trpc.occasions.save.useMutation({
    onSuccess: row => {
      const { slug, title, titleAr, imageUrl, startsOn, endsOn, includeTagged } = row;
      const next = { slug, title, titleAr, imageUrl, startsOn, endsOn, includeTagged };
      const nowFollowing = isCalendarSlug(slug) && !startsOn && !endsOn;
      setContent(next);
      setChosen(row.products);
      setFollow(nowFollowing);
      setSaved(snapshot(next, row.products, nowFollowing));
      setTried(false);
      toast.success(t("occasions.saved"));
      void refresh();
      if (id === null) navigate(`/admin/occasions/${row.id}`, { replace: true });
    },
    onError: error => fail(error.message),
  });
  const setStatus = trpc.occasions.setStatus.useMutation({
    onSuccess: row => {
      toast.success(t(row.status === "published" ? "occasions.publishedToast" : row.status === "hidden" ? "occasions.hiddenToast" : status === "hidden" ? "occasions.shownAgain" : "occasions.takenDown"));
      void refresh();
    },
    onError: error => fail(error.message),
  });
  const remove = trpc.occasions.delete.useMutation({
    onSuccess: () => {
      toast.success(t("occasions.deleted"));
      void refresh();
      navigate("/admin/occasions", { replace: true });
    },
    onError: error => fail(error.message),
  });

  /** Whether the form can go: says what is wrong under its box and goes to the first. */
  const ready = () => {
    const first = OCCASION_FIELDS.find(field => problems[field]);
    if (!first) return true;
    setTried(true);
    requestAnimationFrame(() => document.getElementById(`occasion-${first}`)?.focus());
    return false;
  };
  const body = () => ({ id, occasion: { ...sending, productIds: chosen.map(one => one.id) } });
  const onSave = () => { if (ready()) save.mutate(body()); };
  const publish = async () => {
    if (id === null || !ready()) return;
    if (dirty) {
      const kept = await save.mutateAsync(body()).catch(() => null);
      if (!kept) return;
    }
    setStatus.mutate({ id, status: "published" });
  };

  const patch = (change: Partial<OccasionContent>) => setContent(current => ({ ...current, ...change }));
  const said = (field: OccasionField) => (tried && problems[field] ? t(problems[field]!) : undefined);
  const busy = save.isPending || setStatus.isPending || remove.isPending;
  const calendarName = calendar ? t(occasionFromSlug(content.slug)!.label) : "";
  const name = (isArabic ? content.titleAr : content.title) || content.title || content.titleAr;
  /* What the home page would have to show: the chosen the shop shows, and what the stores tagged. */
  const has = chosen.filter(one => one.live).length + (content.includeTagged ? tagged : 0);
  const short = id !== null && has < MIN_SHELF_PRODUCTS;
  /* The words a store can tag a product with for it, each said once however it is spelled. */
  const words = [content.title, content.titleAr, ...(calendar ? occasionFromSlug(content.slug)!.tags : [])]
    .map(word => word.trim())
    .filter((word, index, all) => foldTag(word) && all.findIndex(other => foldTag(other) === foldTag(word)) === index);

  return (
    <>
      <PageHeader
        title={name || t("occasions.new")}
        meta={id !== null ? (
          <>
            <Pill tone={STATUS_TONE[status]}>{t(STATUS_LABEL[status])}</Pill>
            {season}
            {status === "published" ? (
              <a href={shopHref(`/category/all?occasion=${content.slug}`)} target="_blank" rel="noreferrer" className="font-semibold text-[#0a285a] underline underline-offset-2">{t("occasions.viewPage")}</a>
            ) : null}
          </>
        ) : undefined}
      >
        <BackLink href="/admin/occasions">{t("occasions.back")}</BackLink>
      </PageHeader>

      {/* One column that may be narrower than its widest row: a chosen product's
          name is one truncated line, and a grid track is as wide as its content
          unless told otherwise — which propped a 320px phone open to 386. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
        <Card title={t("occasions.names")}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t("occasions.nameEn")} error={said("title")}>
              <input
                id="occasion-title"
                dir="ltr"
                lang="en"
                value={content.title}
                maxLength={OCCASION_TITLE_MAX}
                onChange={event => {
                  const title = event.target.value;
                  patch(slugTyped || slugLocked ? { title } : { title, slug: title.trim() ? occasionSlug(title) : "" });
                }}
                className={fieldClass}
              />
            </Field>
            <Field label={t("occasions.nameAr")} error={said("titleAr")}>
              <input id="occasion-titleAr" dir="rtl" lang="ar" value={content.titleAr} maxLength={OCCASION_TITLE_MAX} onChange={event => patch({ titleAr: event.target.value })} className={fieldClass} />
            </Field>
            <Field
              className="md:col-span-2"
              label={t("occasions.slug")}
              error={said("slug")}
              hint={calendar ? t("occasions.slugCalendar", { name: calendarName }) : slugLocked ? t("occasions.slugLocked") : t("occasions.slugHint")}
            >
              <input
                id="occasion-slug"
                dir="ltr"
                lang="en"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={content.slug}
                maxLength={OCCASION_SLUG_MAX}
                disabled={slugLocked}
                onChange={event => { setSlugTyped(true); patch({ slug: event.target.value.toLowerCase() }); }}
                className={fieldClass}
              />
            </Field>
          </div>
        </Card>

        <PictureCard imageUrl={content.imageUrl} onChange={imageUrl => patch({ imageUrl })} />

        <Card title={t("occasions.dates")} description={t("occasions.datesHint")}>
          <div className="grid gap-4">
            {calendar ? (
              <Toggle checked={follow} onChange={setFollow} label={t("occasions.followCalendar")} hint={t("occasions.followCalendarHint")} />
            ) : null}
            {following ? null : (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("occasions.startsOn")} error={said("startsOn")}>
                  <input id="occasion-startsOn" type="date" value={content.startsOn ?? ""} onChange={event => patch({ startsOn: event.target.value || null })} className={fieldClass} />
                </Field>
                <Field label={t("occasions.endsOn")} error={said("endsOn")}>
                  <input id="occasion-endsOn" type="date" value={content.endsOn ?? ""} min={content.startsOn ?? undefined} onChange={event => patch({ endsOn: event.target.value || null })} className={fieldClass} />
                </Field>
              </div>
            )}
          </div>
        </Card>

        <ProductsCard chosen={chosen} onChange={setChosen}>
          <Toggle
            className="mt-4"
            checked={content.includeTagged}
            onChange={includeTagged => patch({ includeTagged })}
            label={t("occasions.includeTagged")}
            hint={(
              <>
                {words.length ? t("occasions.includeTaggedHint", { words: words.join(isArabic ? "، " : ", ") }) : null}
                {id !== null && content.includeTagged ? <span className="mt-1 block">{t("occasions.taggedCount", { count: tagged })}</span> : null}
              </>
            )}
          />
        </ProductsCard>

        <Card
          title={t("occasions.publish")}
          description={id === null ? t("occasions.saveFirst") : t(status === "published" ? "occasions.publishedNote" : status === "hidden" ? "occasions.hiddenNote" : "occasions.publishNote")}
          footer={(
            <>
              {id !== null ? (
                <button type="button" onClick={() => setDeleting(true)} disabled={busy} className={`${buttonClass.quietDanger} me-auto`}>
                  <Trash2 className="size-4" aria-hidden />{t("occasions.delete")}
                </button>
              ) : null}
              <button type="button" onClick={onSave} disabled={busy || (!dirty && id !== null)} className={buttonClass.secondary}>
                {save.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}{t(save.isPending ? "occasions.saving" : "occasions.save")}
              </button>
              {id !== null && status === "published" ? (
                <button type="button" onClick={() => setStatus.mutate({ id, status: "draft" })} disabled={busy} className={buttonClass.secondary}>{t("occasions.takeDown")}</button>
              ) : null}
              {id !== null && status === "hidden" ? (
                <button type="button" onClick={() => setStatus.mutate({ id, status: "draft" })} disabled={busy} className={buttonClass.secondary}>{t("occasions.showAgain")}</button>
              ) : null}
              {id !== null && status !== "published" ? (
                <button type="button" onClick={() => void publish()} disabled={busy} className={buttonClass.primary}>{t("occasions.publish")}</button>
              ) : null}
            </>
          )}
        >
          {/* What the stores tagged is counted by the server, so a new one is not judged before it is saved. */}
          {short ? <Notice tone="warning">{t("occasions.needsMore", { have: has, floor: MIN_SHELF_PRODUCTS })}</Notice> : null}
          {status === "draft" && calendar ? <Notice className={short ? "mt-3" : ""}>{t("occasions.customDraft")}</Notice> : null}
        </Card>
      </div>

      <ConfirmDialog
        open={deleting}
        tone="danger"
        title={t("occasions.deleteTitle", { name })}
        body={t(calendar ? "occasions.deleteBodyCalendar" : "occasions.deleteBody")}
        confirmLabel={t("occasions.delete")}
        pending={remove.isPending}
        onConfirm={() => { if (id !== null) remove.mutate({ id }); }}
        onClose={() => setDeleting(false)}
      />
    </>
  );
}

/** The banner: what the home page will draw, or the way to choose one. */
function PictureCard({ imageUrl, onChange }: { imageUrl: string | null; onChange: (imageUrl: string | null) => void }) {
  const { t, tError } = useTranslation();
  const ask = useConfirmRemoval();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const picked = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const prepared = await prepareBanner(file);
      if (typeof prepared === "string") throw new Error(prepared);
      const response = await fetch("/api/media", { method: "POST", headers: { "Content-Type": prepared.type }, body: prepared.blob, credentials: "same-origin" });
      const body = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!response.ok || !body.url) throw new Error(body.error ?? "media.failed");
      onChange(body.url);
    } catch (error) {
      toast.error(tError(error instanceof Error ? error.message : "media.failed"));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <Card title={t("occasions.picture")} description={t("occasions.pictureHint")}>
      <input ref={input} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden onChange={event => void picked(event.target.files?.[0])} />
      {imageUrl ? (
        <img src={imageUrl} alt="" loading="lazy" decoding="async" className="aspect-[3/1] w-full max-w-2xl rounded-2xl bg-[#eef2f8] object-cover" />
      ) : null}
      <div className={`flex flex-wrap gap-2 ${imageUrl ? "mt-3" : ""}`}>
        <button type="button" onClick={() => input.current?.click()} disabled={busy} className={buttonClass.secondary}>
          {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <ImagePlus className="size-4" aria-hidden />}
          {t(busy ? "occasions.pictureUploading" : imageUrl ? "occasions.changePicture" : "occasions.choosePicture")}
        </button>
        {imageUrl ? (
          <button type="button" onClick={() => void ask({ title: t("remove.formTitle"), body: t("remove.formBody") }).then(sure => { if (sure) onChange(null); })} disabled={busy} className={buttonClass.quietDanger}>
            <X className="size-4" aria-hidden />{t("occasions.removePicture")}
          </button>
        ) : null}
      </div>
    </Card>
  );
}

/**
 * The products chosen, in the order the shelf shows them, and the search that
 * adds to them. The search is the products page's own, over every store, so
 * what it finds is what NetLet could put on the shop; a product the shop does
 * not show right now can be chosen and says so.
 */
function ProductsCard({ chosen, onChange, children }: { chosen: Chosen[]; onChange: (chosen: Chosen[]) => void; /** Under the search: whether the stores' tagged products follow. */ children?: ReactNode }) {
  const { t, isArabic } = useTranslation();
  const ask = useConfirmRemoval();
  const [typed, setTyped] = useState("");
  const [term, setTerm] = useState("");
  /* Asked once the typing pauses, not per letter. */
  useEffect(() => {
    const timer = window.setTimeout(() => setTerm(typed.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [typed]);
  const found = trpc.inventory.products.list.useQuery({ query: term || undefined, pageSize: 20 }, { placeholderData: previous => previous });
  const full = chosen.length >= MAX_OCCASION_PRODUCTS;
  const has = new Set(chosen.map(one => one.id));
  const nameOf = (one: { title: string; titleAr: string | null }) => (isArabic && one.titleAr?.trim()) || one.title;
  const move = (index: number, by: -1 | 1) => {
    const next = [...chosen];
    const [one] = next.splice(index, 1);
    next.splice(index + by, 0, one);
    onChange(next);
  };

  return (
    <Card title={t("occasions.products")} description={t("occasions.productsHint")}>
      <p className="text-[13px] font-semibold text-[#0a285a]">{t("occasions.productsCount", { count: chosen.length, max: MAX_OCCASION_PRODUCTS })}</p>
      {chosen.length === 0 ? (
        <p className="mt-2 text-[13px] ink-muted">{t("occasions.productsNone")}</p>
      ) : (
        <ol className="mt-2 divide-y divide-[#eef1f5] rounded-xl border border-[#e1e7ef] bg-white">
          {chosen.map((one, index) => {
            const label = nameOf(one);
            return (
              /* On a phone the three buttons go under the name: beside it they left
                 a 320px screen room for "Wi…". */
              <li key={one.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
                <Thumb src={one.imageUrl} alt="" className="size-11 shrink-0 rounded-lg object-cover" />
                <span className="min-w-0 flex-1 basis-32">
                  <span dir="auto" className="line-clamp-2 text-[14px] font-semibold text-[#0a285a]">{label}</span>
                  <span className="flex flex-wrap items-center gap-x-2 text-[12px] ink-muted">
                    {one.vendorName ? <bdi>{one.vendorName}</bdi> : null}
                    {one.live ? null : <span className="font-semibold text-[#6b4f1d]">{t("occasions.notLive")}</span>}
                  </span>
                </span>
                <span className="ms-auto flex shrink-0 gap-1">
                  <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label={t("occasions.moveUp", { name: label })} className={`${smallButtonClass.secondary} w-9 px-0`}>
                    <ArrowUp className="size-4" aria-hidden />
                  </button>
                  <button type="button" onClick={() => move(index, 1)} disabled={index === chosen.length - 1} aria-label={t("occasions.moveDown", { name: label })} className={`${smallButtonClass.secondary} w-9 px-0`}>
                    <ArrowDown className="size-4" aria-hidden />
                  </button>
                  <button type="button" onClick={() => void ask({ title: t("remove.formTitle"), body: t("remove.formBody") }).then(sure => { if (sure) onChange(chosen.filter(other => other.id !== one.id)); })} aria-label={t("occasions.removeNamed", { name: label })} className={`${smallButtonClass.quietDanger} w-9 px-0`}>
                    <X className="size-4" aria-hidden />
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
      )}

      <div className="relative mt-4">
        <Search className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-[#6b7c93]" aria-hidden />
        <input
          type="search"
          dir="auto"
          value={typed}
          onChange={event => setTyped(event.target.value)}
          aria-label={t("occasions.productsSearch")}
          placeholder={t("occasions.productsSearch")}
          className={`${fieldClass} ps-10`}
        />
      </div>
      <ul className="mt-2 max-h-80 divide-y divide-[#eef1f5] overflow-y-auto rounded-xl border border-[#e1e7ef] bg-white" aria-busy={found.isFetching}>
        {found.isLoading ? <li className="px-3 py-3"><LoaderCircle className="size-4 animate-spin ink-muted" aria-hidden /></li> : null}
        {!found.isLoading && (found.data?.rows.length ?? 0) === 0 ? <li className="px-3 py-3 text-[13px] ink-muted">{t("occasions.searchNone")}</li> : null}
        {(found.data?.rows ?? []).map(row => {
          const label = nameOf(row);
          const added = has.has(row.id);
          return (
            <li key={row.id} className="flex items-center gap-3 px-3 py-2">
              <Thumb src={row.images.find(image => image.kind === "image")?.url ?? null} alt="" className="size-11 shrink-0 rounded-lg object-cover" />
              <span className="min-w-0 flex-1">
                <span dir="auto" className="line-clamp-2 text-[14px] font-semibold text-[#0a285a]">{label}</span>
                <span className="flex flex-wrap items-center gap-x-2 text-[12px] ink-muted">
                  {row.vendorName ? <bdi>{row.vendorName}</bdi> : null}
                  {/* Words that wrap, not a pill: a pill is one line, and on a 320px phone it propped the page open. */}
                  {row.status === "published" ? null : <span className="font-semibold text-[#6b4f1d]">{t("occasions.notLive")}</span>}
                </span>
              </span>
              <button
                type="button"
                disabled={added || full}
                aria-label={added ? undefined : t("occasions.addNamed", { name: label })}
                onClick={() => onChange([...chosen, {
                  id: row.id,
                  title: row.title,
                  titleAr: row.titleAr,
                  vendorName: row.vendorName,
                  imageUrl: row.images.find(image => image.kind === "image")?.url ?? null,
                  live: row.status === "published",
                }])}
                className={smallButtonClass.secondary}
              >
                {added ? t("occasions.added") : <><Plus className="size-3.5" aria-hidden />{t("occasions.add")}</>}
              </button>
            </li>
          );
        })}
      </ul>
      {children}
    </Card>
  );
}
