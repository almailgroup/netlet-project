import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowRight,
  Bell,
  CalendarClock,
  ChevronDown,
  CircleAlert,
  CircleCheckBig,
  Copy,
  Eye,
  Info,
  MapPin,
  MessageCircle,
  Package,
  PackageSearch,
  Plus,
  Search,
  Share2,
  TriangleAlert,
  Warehouse,
  X,
} from "lucide-react";
import { useLanguage } from "../i18n.js";
import { useNoIndex, usePageTitle } from "../hooks.js";
import { Dialog } from "../components/ui/Dialog.js";
import { Tabs } from "../components/ui/Tabs.js";
import { EmptyState } from "../components/ui/EmptyState.js";
import { STATUS_ICONS, StatusPill } from "../components/Status.js";
import { Progress } from "../components/Progress.js";
import { Timeline } from "../components/Timeline.js";
import { PreviewTag } from "../preview.js";
import type { Status, Tone } from "../../shared/status.js";
import { toneOf } from "../../shared/status.js";
import type { TrackingEvent } from "../../shared/shipment.js";
import type { Key } from "../../shared/i18n.js";
import { GOVERNORATES, governorateName } from "../../shared/kuwait.js";

const SECTIONS: readonly { id: string; label: Key }[] = [
  { id: "colours", label: "sg.colours" },
  { id: "type", label: "sg.type" },
  { id: "shape", label: "sg.shape" },
  { id: "buttons", label: "sg.buttons" },
  { id: "fields", label: "sg.fields" },
  { id: "cards", label: "sg.cards" },
  { id: "statuses", label: "sg.statuses" },
  { id: "notices", label: "sg.notices" },
  { id: "chips", label: "sg.chipsTabs" },
  { id: "dialog", label: "sg.dialog" },
  { id: "accordion", label: "sg.accordion" },
  { id: "progress", label: "sg.progress" },
  { id: "timeline", label: "sg.timeline" },
  { id: "states", label: "sg.states" },
  { id: "icons", label: "sg.icons" },
];

const COLOURS: readonly { group: Key; tokens: string[] }[] = [
  { group: "sg.colourBrand", tokens: ["brand", "brand-strong", "brand-tint", "brand-wash", "on-brand-soft"] },
  { group: "sg.colourInk", tokens: ["ink", "ink-muted", "ground", "surface", "line", "field-line"] },
  { group: "sg.colourStates", tokens: ["attention-ink", "attention-fill", "stopped-ink", "stopped-fill", "preview-ink", "preview-fill"] },
];
const TYPE = ["6xl", "5xl", "4xl", "3xl", "2xl", "xl", "lg", "md", "sm", "xs", "2xs"];
const SPACE = ["1", "2", "3", "4", "5", "6", "8", "10", "12", "16", "20"];
const RADII = ["xs", "sm", "md", "lg", "xl", "full"];
const SHADOWS = ["xs", "card", "raised", "overlay"];

/**
 * The nine stages a delivery company names, each with the status it is on
 * ShipLee and the badge it wears. "At hub" is not a status yet: the staff
 * desk cannot set it, so its badge is drawn here and nowhere else.
 */
const STAGE_BADGES: readonly { name: Key; status: Status | null }[] = [
  { name: "sg.stageLabel", status: "created" },
  { name: "status.picked_up", status: "picked_up" },
  { name: "status.in_transit", status: "in_transit" },
  { name: "sg.stageHub", status: null },
  { name: "status.out_for_delivery", status: "out_for_delivery" },
  { name: "status.delivered", status: "delivered" },
  { name: "sg.stageFailed", status: "attempted" },
  { name: "sg.stageReturned", status: "returned" },
  { name: "sg.stageException", status: "on_hold" },
];
const TONES: readonly { tone: Tone; name: Key; use: Key; sample: Status }[] = [
  { tone: "waiting", name: "sg.toneWaiting", use: "sg.toneWaitingUse", sample: "created" },
  { tone: "moving", name: "sg.toneMoving", use: "sg.toneMovingUse", sample: "in_transit" },
  { tone: "done", name: "sg.toneDone", use: "sg.toneDoneUse", sample: "delivered" },
  { tone: "attention", name: "sg.toneAttention", use: "sg.toneAttentionUse", sample: "attempted" },
  { tone: "stopped", name: "sg.toneStopped", use: "sg.toneStoppedUse", sample: "cancelled" },
];

/** What the tokens hold right now, read from the stylesheet, so this page cannot disagree with it. */
function useTokenValues(names: string[]): Record<string, string> {
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    const style = getComputedStyle(document.documentElement);
    setValues(Object.fromEntries(names.map(name => [name, style.getPropertyValue(`--${name}`).trim()])));
  }, [names.join(",")]);
  return values;
}

function sampleEvents(): TrackingEvent[] {
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
  return [
    { status: "out_for_delivery", location: "Salmiya", note: null, happenedAt: hoursAgo(1) },
    { status: "in_transit", location: "Shuwaikh hub", note: null, happenedAt: hoursAgo(20) },
    { status: "picked_up", location: "Shuwaikh", note: null, happenedAt: hoursAgo(26) },
    { status: "created", location: null, note: null, happenedAt: hoursAgo(30) },
  ];
}

/**
 * /styleguide: every part ShipLee's pages are built from, in every state, in
 * the page's language and direction. The design reference, not a customer
 * page — never linked outside preview, and search engines are told so.
 */
export function Styleguide() {
  const { t, lang } = useLanguage();
  usePageTitle(t("title.styleguide"));
  useNoIndex();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [noticeShown, setNoticeShown] = useState(true);
  const [pressed, setPressed] = useState("all");
  const colourValues = useTokenValues(COLOURS.flatMap(group => group.tokens));
  const typeValues = useTokenValues(TYPE.map(size => `text-${size}`));

  return (
    <div className="container styleguide">
      <div className="page-head">
        <h1 className="page-title">{t("sg.title")}</h1>
        <p className="page-lead">{t("sg.lead")}</p>
        <nav className="chips sg-jump" aria-label={t("sg.jump")}>
          {SECTIONS.map(section => (
            <a key={section.id} href={`#${section.id}`} className="chip">{t(section.label)}</a>
          ))}
        </nav>
      </div>

      <Section id="colours" title={t("sg.colours")} lead={t("sg.coloursLead")}>
        {COLOURS.map(group => (
          <div key={group.group} className="sg-block">
            <h3 className="small-title">{t(group.group)}</h3>
            <ul className="sg-swatches">
              {group.tokens.map(token => (
                <li key={token} className="sg-swatch">
                  <span className="sg-chip" data-token={token} aria-hidden="true" />
                  <code>--{token}</code>
                  <span className="muted small" dir="ltr">{colourValues[token]}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Section>

      <Section id="type" title={t("sg.type")} lead={t("sg.typeLead")}>
        <ul className="sg-type">
          {TYPE.map(size => (
            <li key={size}>
              <code>--text-{size} · <span dir="ltr">{typeValues[`text-${size}`]}</span></code>
              <span className="sg-type-sample" data-size={size}>{t("home.title")}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="shape" title={t("sg.shape")} lead={t("sg.shapeLead")}>
        <div className="sg-block">
          <h3 className="small-title">{t("sg.space")}</h3>
          <ul className="sg-space-list">
            {SPACE.map(step => (
              <li key={step}><code>--space-{step}</code><span className="sg-space" data-token={step} aria-hidden="true" /></li>
            ))}
          </ul>
        </div>
        <div className="sg-block">
          <h3 className="small-title">{t("sg.radius")}</h3>
          <ul className="sg-row">
            {RADII.map(radius => (
              <li key={radius} className="sg-radius-item"><span className="sg-radius" data-token={radius} aria-hidden="true" /><code>--radius-{radius}</code></li>
            ))}
          </ul>
        </div>
        <div className="sg-block">
          <h3 className="small-title">{t("sg.shadow")}</h3>
          <ul className="sg-row">
            {SHADOWS.map(shadow => (
              <li key={shadow} className="sg-shadow" data-token={shadow}><code>--shadow-{shadow}</code></li>
            ))}
          </ul>
        </div>
      </Section>

      <Section id="buttons" title={t("sg.buttons")} lead={t("sg.buttonsLead")}>
        <div className="sg-block">
          <div className="button-row">
            <button type="button" className="button button-primary">{t("track.button")}</button>
            <button type="button" className="button button-secondary">{t("result.getHelp")}</button>
            <button type="button" className="button button-quiet"><Copy size={16} aria-hidden="true" />{t("result.copy")}</button>
            <button type="button" className="button button-danger">{t("sg.sampleDanger")}</button>
          </div>
        </div>
        <div className="sg-block">
          <h3 className="small-title">{t("sg.sizes")}</h3>
          <div className="button-row">
            <button type="button" className="button button-primary button-small"><Plus size={16} aria-hidden="true" />{t("staff.new")}</button>
            <button type="button" className="button button-secondary button-small"><Share2 size={16} aria-hidden="true" />{t("result.share")}</button>
            <button type="button" className="button button-secondary button-icon" aria-label={t("result.share")}><Share2 size={18} aria-hidden="true" /></button>
            <button type="button" className="button button-primary button-block">{t("track.button")}</button>
          </div>
        </div>
        <div className="sg-block">
          <h3 className="small-title">{t("sg.buttonStates")}</h3>
          <div className="button-row">
            <button type="button" className="button button-primary" disabled>{t("sg.disabled")}</button>
            <button type="button" className="button button-primary" aria-busy="true" disabled>
              <span className="spinner" aria-hidden="true" />
              {t("form.saving")}
            </button>
            <button type="button" className="button button-secondary" disabled>{t("sg.disabled")}</button>
          </div>
        </div>
        <div className="sg-block sg-on-brand">
          <h3 className="small-title">{t("sg.onBrand")}</h3>
          <div className="button-row">
            <a href="#buttons" className="button button-light">{t("sg.sampleLight")}<ArrowRight size={16} className="flip" aria-hidden="true" /></a>
            <a href="#buttons" className="button button-ghost-light">{t("sg.sampleGhost")}</a>
          </div>
        </div>
      </Section>

      <Section id="fields" title={t("sg.fields")} lead={t("sg.fieldsLead")}>
        <div className="form-grid two">
          <div className="field">
            <label className="field-label" htmlFor="sg-text">{t("track.label")}</label>
            <input id="sg-text" className="input ltr-input" placeholder={t("track.placeholder")} aria-describedby="sg-text-hint" />
            <p id="sg-text-hint" className="field-hint">{t("track.hint")}</p>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="sg-error">{t("track.label")}</label>
            <input id="sg-error" className="input ltr-input" defaultValue="SL12345" aria-invalid="true" aria-describedby="sg-error-text" />
            <p id="sg-error-text" className="field-error"><CircleAlert size={15} aria-hidden="true" />{t("track.shape")}</p>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="sg-select">{t("form.governorate")}</label>
            <select id="sg-select" className="input" defaultValue="">
              <option value="" disabled>{t("form.choose")}</option>
              {GOVERNORATES.slice(0, 3).map(g => <option key={g.slug}>{governorateName(g.slug, lang)}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="sg-disabled">{t("form.area")} <span className="optional">({t("form.optional")})</span></label>
            <input id="sg-disabled" className="input" disabled defaultValue="Salmiya" />
          </div>
          <div className="field full">
            <label className="field-label" htmlFor="sg-note">{t("sg.noteLabel")}</label>
            <textarea id="sg-note" className="input" />
          </div>
          <fieldset className="field full sg-fieldset">
            <legend className="field-label">{t("sg.choiceLegend")}</legend>
            <div className="choices grid">
              {(["sg.choiceMorning", "sg.choiceAfternoon", "sg.choiceEvening"] as Key[]).map((choice, index) => (
                <label key={choice} className="choice">
                  <input type="radio" name="sg-time" defaultChecked={index === 0} />
                  <span className="choice-text"><strong>{t(choice)}</strong></span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="choice full">
            <input type="checkbox" defaultChecked />
            <span className="choice-text">
              <strong>{t("sg.checkTitle")}</strong>
              <span>{t("sg.checkBody")}</span>
            </span>
          </label>
        </div>
      </Section>

      <Section id="cards" title={t("sg.cards")} lead={t("sg.cardsLead")}>
        <div className="card-grid four">
          <div className="card"><h3 className="small-title">{t("sg.cardDefault")}</h3><p className="muted small">{t("sg.cardDefaultUse")}</p></div>
          <div className="card card-flat"><h3 className="small-title">{t("sg.cardFlat")}</h3><p className="muted small">{t("sg.cardFlatUse")}</p></div>
          <div className="card card-tinted"><h3 className="small-title">{t("sg.cardTinted")}</h3><p className="muted small">{t("sg.cardTintedUse")}</p></div>
          <a href="#cards" className="card card-link feature">
            <span className="icon-tile"><Package size={22} aria-hidden="true" /></span>
            <h3>{t("sg.cardLink")}</h3>
            <p>{t("sg.cardLinkUse")}</p>
          </a>
        </div>
      </Section>

      <Section id="statuses" title={t("sg.statuses")} lead={t("sg.statusesLead")}>
        <div className="table-wrap" role="region" aria-labelledby="status-table-caption" tabIndex={0}>
          <table className="table">
            <caption id="status-table-caption" className="sr-only">{t("sg.statusTable")}</caption>
            <thead>
              <tr><th scope="col">{t("sg.colStage")}</th><th scope="col">{t("sg.colBadge")}</th><th scope="col">{t("sg.colFamily")}</th></tr>
            </thead>
            <tbody>
              {STAGE_BADGES.map(({ name, status }) => (
                <tr key={name}>
                  <th scope="row" className="sg-th">{t(name)}</th>
                  <td>
                    {status ? <StatusPill status={status} /> : (
                      <span className="sg-inline">
                        <span className="pill tone-moving"><Warehouse size={14} aria-hidden="true" />{t("sg.stageHub")}</span>
                        <PreviewTag label={t("sg.notStatusYet")} />
                      </span>
                    )}
                  </td>
                  <td>{t(`sg.tone${capital(status ? toneOf(status) : "moving")}` as Key)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="sg-block">
          <h3 className="small-title">{t("sg.families")}</h3>
          <ul className="sg-tones">
            {TONES.map(({ tone, name, use, sample }) => (
              <li key={tone} className="sg-tone">
                <StatusPill status={sample} />
                <span><strong>{t(name)}</strong><span className="muted small">{t(use)}</span></span>
              </li>
            ))}
          </ul>
        </div>
        <div className="sg-block">
          <h3 className="small-title">{t("sg.badges")}</h3>
          <div className="chips">
            <span className="badge">{t("sg.badgeBrand")}</span>
            <span className="badge neutral">{t("sg.badgeNeutral")}</span>
            <span className="badge attention">{t("sg.badgeAttention")}</span>
            <span className="badge stopped">{t("sg.badgeStopped")}</span>
            <PreviewTag />
          </div>
        </div>
      </Section>

      <Section id="notices" title={t("sg.notices")} lead={t("sg.noticesLead")}>
        <div className="sg-stack">
          <p className="notice"><Info size={18} aria-hidden="true" /><span className="notice-body"><strong className="notice-title">{t("sg.noticeInfo")}</strong><span>{t("faq.updates.a")}</span></span></p>
          <p className="notice notice-attention"><TriangleAlert size={18} aria-hidden="true" /><span className="notice-body"><strong className="notice-title">{t("status.attempted")}</strong><span>{t("say.attempted")}</span></span></p>
          <p className="notice notice-stopped"><CircleAlert size={18} aria-hidden="true" /><span className="notice-body"><strong className="notice-title">{t("result.errorTitle")}</strong><span>{t("result.errorBody")}</span></span></p>
          {noticeShown ? (
            <div className="notice notice-preview">
              <Eye size={18} aria-hidden="true" />
              <span className="notice-body"><strong className="notice-title">{t("preview.tag")}</strong><span>{t("preview.bar")}</span></span>
              <button type="button" className="button button-quiet button-icon button-small notice-close" onClick={() => setNoticeShown(false)} aria-label={t("ui.dismiss")}><X size={18} aria-hidden="true" /></button>
            </div>
          ) : (
            <button type="button" className="button button-secondary button-small" onClick={() => setNoticeShown(true)}>{t("sg.showAgain")}</button>
          )}
        </div>
      </Section>

      <Section id="chips" title={t("sg.chipsTabs")} lead={t("sg.chipsLead")}>
        <div className="chips" role="group" aria-label={t("sg.chipsGroup")}>
          {(["all", "moving", "done"] as const).map(id => (
            <button key={id} type="button" className="chip" aria-pressed={pressed === id} onClick={() => setPressed(id)}>
              {t(id === "all" ? "sg.chipAll" : id === "moving" ? "sg.toneMoving" : "sg.toneDone")}
            </button>
          ))}
        </div>
        <div className="sg-block">
          <Tabs
            label={t("sg.tabsName")}
            tabs={[
              { id: "updates", label: t("result.updates"), panel: <p className="muted">{t("faq.updates.a")}</p> },
              { id: "pay", label: t("result.cod"), panel: <p className="muted">{t("faq.cod.a")}</p> },
              { id: "help", label: t("nav.help"), panel: <p className="muted">{t("help.lead")}</p> },
            ]}
          />
        </div>
      </Section>

      <Section id="dialog" title={t("sg.dialog")} lead={t("sg.dialogLead")}>
        <button type="button" className="button button-secondary" onClick={() => setDialogOpen(true)}>
          <CalendarClock size={18} aria-hidden="true" />
          {t("sg.openDialog")}
        </button>
        <Dialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          title={t("sg.dialogTitle")}
          lead={t("sg.dialogBody")}
          footer={
            <>
              <button type="button" className="button button-secondary" onClick={() => setDialogOpen(false)}>{t("form.cancel")}</button>
              <button type="button" className="button button-primary" onClick={() => setDialogOpen(false)}>{t("sg.dialogConfirm")}</button>
            </>
          }
        >
          <div className="field">
            <label className="field-label" htmlFor="sg-dialog-note">{t("sg.noteLabel")}</label>
            <textarea id="sg-dialog-note" className="input" data-autofocus="" />
          </div>
        </Dialog>
      </Section>

      <Section id="accordion" title={t("sg.accordion")} lead={t("sg.accordionLead")}>
        <div className="faq questions">
          {([["faq.number.q", "faq.number.a"], ["faq.cod.q", "faq.cod.a"]] as [Key, Key][]).map(([question, answer]) => (
            <details key={question}>
              <summary>{t(question)}<ChevronDown size={18} aria-hidden="true" /></summary>
              <p>{t(answer)}</p>
            </details>
          ))}
        </div>
      </Section>

      <Section id="progress" title={t("sg.progress")} lead={t("sg.progressLead")}>
        <div className="sg-stack">
          {([[1, false, "status.picked_up"], [3, false, "status.out_for_delivery"], [4, false, "status.delivered"], [3, true, "status.attempted"]] as [number, boolean, Key][]).map(([reached, attention, name]) => (
            <div key={`${reached}-${attention}`} className="card card-flat">
              <p className="small-title">{t(name)}</p>
              <Progress reached={reached} attention={attention} />
            </div>
          ))}
        </div>
      </Section>

      <Section id="timeline" title={t("sg.timeline")} lead={t("sg.timelineLead")}>
        <div className="card card-flat sg-narrow">
          <Timeline events={sampleEvents()} headingLevel={3} />
        </div>
      </Section>

      <Section id="states" title={t("sg.states")} lead={t("sg.statesLead")}>
        <div className="card-grid">
          <div className="card card-flat" aria-busy="true">
            <p className="sr-only">{t("result.loading")}</p>
            <div className="skeleton" data-size="pill" aria-hidden="true" />
            <div className="skeleton" data-size="title" aria-hidden="true" />
            <div className="skeleton" data-size="line" aria-hidden="true" />
            <div className="skeleton" data-size="bar" aria-hidden="true" />
          </div>
          <div className="card card-flat">
            <EmptyState
              headingLevel={3}
              icon={<PackageSearch size={26} />}
              title={t("recent.emptyTitle")}
              body={t("recent.emptyBody")}
              actions={<button type="button" className="button button-primary button-small"><Search size={16} aria-hidden="true" />{t("nav.trackParcel")}</button>}
            />
          </div>
        </div>
      </Section>

      <Section id="icons" title={t("sg.icons")} lead={t("sg.iconsLead")}>
        <ul className="sg-icons">
          {(Object.keys(STATUS_ICONS) as Status[]).map(status => {
            const Icon = STATUS_ICONS[status];
            return <li key={status}><Icon size={22} aria-hidden="true" /><span>{t(`status.${status}`)}</span></li>;
          })}
          {([[Search, "track.button"], [Copy, "result.copy"], [Share2, "result.share"], [MessageCircle, "contact.whatsapp"], [Bell, "sg.iconNotify"], [MapPin, "result.to"], [CalendarClock, "sg.iconSchedule"], [CircleCheckBig, "sg.toneDone"]] as const).map(([Icon, label]) => (
            <li key={label}><Icon size={22} aria-hidden="true" /><span>{t(label)}</span></li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

function Section({ id, title, lead, children }: { id: string; title: string; lead: string; children: ReactNode }) {
  return (
    <section id={id} className="section sg-section" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="section-title">{title}</h2>
      <p className="section-lead">{lead}</p>
      <div className="sg-body">{children}</div>
    </section>
  );
}

function capital(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
