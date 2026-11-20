/**
 * NetLet's team (`Shared/inventory/team.ts`, migration 0090), on the owner's
 * word: "the admin can assign roles to the people that can get access to the
 * admin panel. Like Manager, Finance, HR".
 *
 * Two views. **People**: who is on the team and with which role, putting
 * somebody on it — an account they already have, or a new one with the
 * password they will sign in with — changing a role and taking somebody off.
 * **Roles**: what each role opens, by the panel's areas; the seven ready-made
 * ones and any NetLet makes.
 *
 * The server answers every row with the buttons it would take from the person
 * reading (`mayChange`, `mayRemove`, `mayMakeFull`, `mayEditRoles`), so a
 * member whose role opens Team (HR) is drawn only what HR may do: never a
 * full administrator's row, never their own, never what a role opens. Every
 * move asks first — it changes who reaches what.
 */
import { Check, KeyRound, LoaderCircle, Pencil, Plus, Trash2, UserMinus, UserPlus } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { AdminShell } from "@/components/admin/AdminShell";
import { QueryGate } from "@/components/admin/QueryGate";
import { buttonClass, Card, EmptyState, Field, fieldClass, Notice, PageHeader, PasswordBox, Pill, Segmented, SkeletonRows, smallButtonClass, surfaceClass } from "@/components/admin/ui";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Select } from "@/components/ui/Select";
import { useDateFormat } from "@/hooks/useDateFormat";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/hooks/useTranslation";
import { isolate } from "@/lib/isolate";
import { PORTAL_DOMAIN } from "@/lib/portalHost";
import { failedToLoad } from "@/lib/queryState";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../../Backend/src/routes";
import { checkPassword } from "@shared/auth/passwordStrength";
import type { MessageKey } from "@shared/i18n/dictionary";
import { roleName, roleProblems, TEAM_AREAS, type TeamArea } from "@shared/inventory/team";
import { privatePageMeta } from "@shared/seo";

type Desk = inferRouterOutputs<AppRouter>["team"]["desk"];
type Role = Desk["roles"][number];
type Member = Desk["members"][number];
type View = "people" | "roles";
/** The Select's value for a full administrator: a role is its id. */
const FULL = "full";

export default function AdminStaff() {
  usePageMeta(privatePageMeta("NetLet team"));
  return <AdminShell need="team.manage">{() => <TeamDesk />}</AdminShell>;
}

/** A role's name in the page's language: its own, the other language's, or the ready-made one's. */
function useRoleTitle() {
  const { t, locale } = useTranslation();
  return (role: Pick<Role, "slug" | "name" | "nameAr"> | null): string => {
    if (!role) return t("team.fullAdmin");
    const name = roleName(role, locale);
    return "key" in name ? t(name.key) : name.text;
  };
}

function useAreaNames() {
  const { t } = useTranslation();
  return (areas: readonly TeamArea[]) => areas.map(area => t(`team.area.${area}` as MessageKey)).join(", ");
}

function TeamDesk() {
  const { t } = useTranslation();
  const desk = trpc.team.desk.useQuery();
  const [view, setView] = useState<View>("people");

  if (desk.isLoading) return <SkeletonRows label={t("admin.loading")} />;
  if (failedToLoad(desk) || !desk.data) return <QueryGate queries={[desk]}>{() => null}</QueryGate>;
  const data = desk.data;

  return (
    <>
      <PageHeader title={t("team.title")} description={t("team.description")} />
      {!data.ready ? (
        <EmptyState title={t("team.unavailableTitle")}>{t("team.unavailableBody")}</EmptyState>
      ) : (
        <>
          <Segmented<View>
            label={t("team.views")}
            value={view}
            onChange={setView}
            options={[
              { value: "people", label: t("team.tabPeople"), count: data.members.length },
              { value: "roles", label: t("team.tabRoles"), count: data.roles.length },
            ]}
          />
          <div className="mt-6">{view === "people" ? <People desk={data} /> : <Roles desk={data} />}</div>
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------ people --- */

type Asking =
  | { kind: "role"; member: Member; roleId: number | null }
  | { kind: "remove"; member: Member };

function People({ desk }: { desk: Desk }) {
  const { t, tError } = useTranslation();
  const utils = trpc.useUtils();
  const roleTitle = useRoleTitle();
  const areaNames = useAreaNames();
  const formatDate = useDateFormat();
  const [asking, setAsking] = useState<Asking | null>(null);
  const roleOf = (id: number | null) => (id === null ? null : desk.roles.find(role => role.id === id) ?? null);
  const done = (message: MessageKey) => () => {
    setAsking(null);
    toast.success(t(message));
    void utils.team.desk.invalidate();
  };
  const failed = (error: { message: string }) => {
    setAsking(null);
    toast.error(tError(error.message));
  };
  const setRole = trpc.team.setRole.useMutation({ onSuccess: done("team.roleChanged"), onError: failed });
  const remove = trpc.team.remove.useMutation({ onSuccess: done("team.removed"), onError: failed });
  const busy = setRole.isPending || remove.isPending;

  return (
    <div className="space-y-6">
      <AddMember desk={desk} />

      <section aria-labelledby="team-members">
        <h2 id="team-members" className="text-[16px] leading-6 font-bold text-[#0a285a]">{t("team.membersTitle")}</h2>
        <ul className={`mt-3 divide-y divide-[#eef1f5] overflow-hidden ${surfaceClass}`}>
          {desk.members.map(member => {
            const name = member.name || member.email || "";
            const role = roleOf(member.roleId);
            return (
              <li key={member.userId} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 p-4 sm:px-5">
                <div className="min-w-0 flex-1 basis-64">
                  <p className="flex flex-wrap items-center gap-2 text-[15px] font-bold text-[#0a285a]">
                    <bdi className="min-w-0 break-words">{name}</bdi>
                    {member.owner ? <Pill tone="navy">{t("team.owner")}</Pill> : null}
                    <Pill tone={role ? "neutral" : "navy"}>{roleTitle(role)}</Pill>
                    {member.you ? <span className="text-[12px] font-semibold ink-muted">{t("team.you")}</span> : null}
                  </p>
                  {member.email && member.name ? <p className="mt-0.5 truncate text-[13px] ink-muted"><bdi dir="ltr">{member.email}</bdi></p> : null}
                  <p className="mt-1.5 text-[13px] leading-5 text-[#3d5376]">
                    {role ? t("team.opens", { areas: areaNames(role.areas) }) : t("team.fullAdminNote")}
                  </p>
                  <p className="mt-1 flex flex-wrap gap-x-4 text-[12px] ink-muted">
                    {member.addedAt ? (
                      <span>{member.addedBy ? t("team.addedBy", { date: formatDate(member.addedAt), name: isolate(member.addedBy) }) : t("team.addedOn", { date: formatDate(member.addedAt) })}</span>
                    ) : null}
                    <span>{member.lastSignedIn ? t("team.lastIn", { date: formatDate(member.lastSignedIn) }) : t("team.neverIn")}</span>
                  </p>
                </div>
                {member.owner ? (
                  <p className="max-w-[16rem] text-[13px] leading-5 ink-muted">{t("team.ownerNote")}</p>
                ) : member.mayChange || member.mayRemove ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {member.mayChange ? (
                      <Select
                        value={member.roleId === null ? FULL : String(member.roleId)}
                        aria-label={t("team.changeRoleLabel", { name: isolate(name) })}
                        disabled={busy}
                        className={`${fieldClass} h-9 min-w-44 text-[13px]`}
                        onChange={event => {
                          const value = event.target.value;
                          const roleId = value === FULL ? null : Number(value);
                          if (roleId === member.roleId) return;
                          setAsking({ kind: "role", member, roleId });
                        }}
                      >
                        {member.mayMakeFull || member.roleId === null ? <option value={FULL}>{t("team.fullAdmin")}</option> : null}
                        {desk.roles.map(one => <option key={one.id} value={String(one.id)}>{roleTitle(one)}</option>)}
                      </Select>
                    ) : null}
                    {member.mayRemove ? (
                      <button type="button" disabled={busy} onClick={() => setAsking({ kind: "remove", member })} className={smallButtonClass.quietDanger}>
                        <UserMinus className="size-4" aria-hidden />{t("team.removeButton")}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      <ConfirmDialog
        open={asking !== null}
        tone={asking?.kind === "remove" ? "danger" : "normal"}
        pending={busy}
        title={
          asking?.kind === "remove" ? t("team.removeTitle", { name: isolate(asking.member.name || asking.member.email || "") })
            : asking?.kind === "role" && asking.roleId === null ? t("team.makeFullTitle", { name: isolate(asking.member.name || asking.member.email || "") })
            : asking?.kind === "role" ? t("team.changeRoleTitle", { name: isolate(asking.member.name || asking.member.email || ""), role: isolate(roleTitle(roleOf(asking.roleId))) })
            : ""
        }
        body={
          asking?.kind === "remove" ? t("team.removeBody", { name: isolate(asking.member.name || asking.member.email || "") })
            : asking?.kind === "role" && asking.roleId === null ? t("team.makeFullBody")
            : asking?.kind === "role" ? t("team.changeRoleBody", { name: isolate(asking.member.name || asking.member.email || "") })
            : ""
        }
        confirmLabel={
          asking?.kind === "remove" ? t("team.removeButton")
            : asking?.kind === "role" && asking.roleId === null ? t("team.makeFullConfirm")
            : t("team.changeRoleConfirm")
        }
        onConfirm={() => {
          if (!asking) return;
          if (asking.kind === "remove") remove.mutate({ userId: asking.member.userId });
          else setRole.mutate({ userId: asking.member.userId, roleId: asking.roleId });
        }}
        onClose={() => setAsking(null)}
      />
    </div>
  );
}

type AddMode = "existing" | "new";

function AddMember({ desk }: { desk: Desk }) {
  const { t, tError } = useTranslation();
  const utils = trpc.useUtils();
  const roleTitle = useRoleTitle();
  const areaNames = useAreaNames();
  const [mode, setMode] = useState<AddMode>("existing");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const firstRole = desk.roles.find(role => role.slug === "manager") ?? desk.roles[0];
  const [choice, setChoice] = useState<string>(firstRole ? String(firstRole.id) : FULL);
  const [tried, setTried] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const formId = useId();

  const finished = () => {
    toast.success(t("team.added"));
    setEmail("");
    setName("");
    setPassword("");
    setTried(false);
    setRefusal(null);
    void utils.team.desk.invalidate();
  };
  const refused = (error: { message: string }) => setRefusal(tError(error.message));
  const add = trpc.team.add.useMutation({ onSuccess: finished, onError: refused });
  const create = trpc.team.create.useMutation({ onSuccess: finished, onError: refused });
  const pending = add.isPending || create.isPending;

  const roleId = choice === FULL ? null : Number(choice);
  const chosen = roleId === null ? null : desk.roles.find(role => role.id === roleId) ?? null;
  const emailProblem = /^\S+@\S+\.\S+$/.test(email.trim()) ? null : t("team.emailNeeded");
  const passwordProblem = mode === "new" && !checkPassword(password).acceptable ? t("team.passwordNeeded") : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    setRefusal(null);
    if (emailProblem || passwordProblem) {
      document.getElementById(emailProblem ? `${formId}-email` : `${formId}-password`)?.focus();
      return;
    }
    if (mode === "existing") add.mutate({ email: email.trim(), roleId });
    else create.mutate({ email: email.trim(), password, name: name.trim() || null, roleId });
  };

  return (
    <Card title={t("team.addTitle")} description={t("team.signInNote", { portal: `admin.${PORTAL_DOMAIN ?? "netlet.net"}` })}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <Segmented<AddMode>
          label={t("team.addTitle")}
          value={mode}
          onChange={value => { setMode(value); setRefusal(null); }}
          options={[
            { value: "existing", label: t("team.addHas") },
            { value: "new", label: t("team.addNew") },
          ]}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("team.email")} error={tried ? emailProblem : null}>
            <input
              id={`${formId}-email`}
              type="email"
              dir="ltr"
              autoComplete="off"
              value={email}
              onChange={event => setEmail(event.target.value)}
              className={fieldClass}
            />
          </Field>
          {mode === "new" ? (
            <Field label={t("team.name")} optional>
              <input dir="auto" autoComplete="off" value={name} onChange={event => setName(event.target.value)} className={fieldClass} />
            </Field>
          ) : null}
          {mode === "new" ? (
            <Field label={t("team.password")} error={tried ? passwordProblem : null}>
              <PasswordBox id={`${formId}-password`} value={password} onChange={setPassword} />
            </Field>
          ) : null}
          <Field label={t("team.role")} hint={chosen ? t("team.opens", { areas: areaNames(chosen.areas) }) : t("team.fullAdminNote")}>
            <Select value={choice} onChange={event => setChoice(event.target.value)}>
              {desk.roles.map(role => <option key={role.id} value={String(role.id)}>{roleTitle(role)}</option>)}
              {desk.mayMakeFull ? <option value={FULL}>{t("team.fullAdmin")}</option> : null}
            </Select>
          </Field>
        </div>
        {refusal ? <Notice tone="danger">{refusal}</Notice> : null}
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={pending} className={buttonClass.primary}>
            {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : mode === "new" ? <KeyRound className="size-4" aria-hidden /> : <UserPlus className="size-4" aria-hidden />}
            {pending ? t("team.adding") : t("team.addButton")}
          </button>
        </div>
      </form>
    </Card>
  );
}

/* ------------------------------------------------------------- roles --- */

function Roles({ desk }: { desk: Desk }) {
  const { t, tError } = useTranslation();
  const utils = trpc.useUtils();
  const roleTitle = useRoleTitle();
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [deleting, setDeleting] = useState<Role | null>(null);
  const remove = trpc.team.roles.delete.useMutation({
    onSuccess: () => { setDeleting(null); toast.success(t("team.roleDeleted")); void utils.team.desk.invalidate(); },
    onError: error => { setDeleting(null); toast.error(tError(error.message)); },
  });

  return (
    <section aria-labelledby="team-roles" className="space-y-4">
      {/* The role cards' names are h3s; the tab's own words are the h2 over them. */}
      <h2 id="team-roles" className="sr-only">{t("team.tabRoles")}</h2>
      {desk.mayEditRoles ? (
        editing === "new" ? (
          <RoleEditor onDone={() => setEditing(null)} />
        ) : (
          <button type="button" onClick={() => setEditing("new")} className={buttonClass.secondary}>
            <Plus className="size-4" aria-hidden />{t("team.newRole")}
          </button>
        )
      ) : (
        <Notice>{t("team.rolesFullOnlyNote")}</Notice>
      )}
      <ul className="grid gap-4 lg:grid-cols-2">
        {desk.roles.map(role => (
          <li key={role.id}>
            {editing === role.id ? (
              <RoleEditor role={role} onDone={() => setEditing(null)} />
            ) : (
              <section aria-label={roleTitle(role)} className={`h-full p-5 ${surfaceClass}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="flex flex-wrap items-center gap-2 text-[15px] font-bold text-[#0a285a]">
                      <bdi>{roleTitle(role)}</bdi>
                      {role.slug ? <Pill tone="navy">{t("team.readyMade")}</Pill> : null}
                    </h3>
                    <p className="mt-0.5 text-[12px] ink-muted">{t("team.membersCount", { count: role.members })}</p>
                  </div>
                  {desk.mayEditRoles ? (
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => setEditing(role.id)} aria-label={t("team.editRole", { name: isolate(roleTitle(role)) })} className={smallButtonClass.secondary}>
                        <Pencil className="size-3.5" aria-hidden />{t("team.edit")}
                      </button>
                      {role.deletable ? (
                        <button type="button" onClick={() => setDeleting(role)} className={smallButtonClass.quietDanger}>
                          <Trash2 className="size-3.5" aria-hidden />{t("team.deleteRole")}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <ul aria-label={t("team.areasLabel")} className="mt-3 flex flex-wrap gap-1.5">
                  {role.areas.map(area => <li key={area}><Pill>{t(`team.area.${area}` as MessageKey)}</Pill></li>)}
                </ul>
              </section>
            )}
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={deleting !== null}
        tone="danger"
        pending={remove.isPending}
        title={deleting ? t("team.deleteRoleTitle", { name: isolate(roleTitle(deleting)) }) : ""}
        body={t("team.deleteRoleBody")}
        confirmLabel={t("team.deleteRoleConfirm")}
        onConfirm={() => deleting && remove.mutate({ id: deleting.id })}
        onClose={() => setDeleting(null)}
      />
    </section>
  );
}

function RoleEditor({ role, onDone }: { role?: Role; onDone: () => void }) {
  const { t, tError } = useTranslation();
  const utils = trpc.useUtils();
  const [name, setName] = useState(role?.name ?? "");
  const [nameAr, setNameAr] = useState(role?.nameAr ?? "");
  const [areas, setAreas] = useState<TeamArea[]>(role ? [...role.areas] : []);
  const [tried, setTried] = useState(false);
  const ready = Boolean(role?.slug);
  const problems = roleProblems({ name, nameAr, areas }, ready);
  const saved = (message: MessageKey) => () => { toast.success(t(message)); void utils.team.desk.invalidate(); onDone(); };
  const failed = (error: { message: string }) => toast.error(tError(error.message));
  const create = trpc.team.roles.create.useMutation({ onSuccess: saved("team.roleCreated"), onError: failed });
  const update = trpc.team.roles.update.useMutation({ onSuccess: saved("team.roleSaved"), onError: failed });
  const pending = create.isPending || update.isPending;
  const idBase = useId();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    const first = problems.name ? "name" : problems.nameAr ? "nameAr" : problems.areas ? "areas" : null;
    if (first) {
      document.getElementById(`${idBase}-${first}`)?.focus();
      return;
    }
    if (role) update.mutate({ id: role.id, name, nameAr, areas });
    else create.mutate({ name, nameAr, areas });
  };
  const toggle = (area: TeamArea, on: boolean) => setAreas(now => (on ? [...now, area] : now.filter(one => one !== area)));

  return (
    <Card title={role ? t("team.editRole", { name: isolate(name || nameAr || (role.slug ? t(`team.role.${role.slug}` as MessageKey) : "")) }) : t("team.newRole")}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("team.roleNameEn")} hint={ready ? t("team.roleNameHint") : undefined} error={tried && problems.name ? t(problems.name) : null}>
            <input id={`${idBase}-name`} dir="auto" value={name} onChange={event => setName(event.target.value)} className={fieldClass} />
          </Field>
          <Field label={t("team.roleNameAr")} error={tried && problems.nameAr ? t(problems.nameAr) : null}>
            <input id={`${idBase}-nameAr`} dir="auto" lang="ar" value={nameAr} onChange={event => setNameAr(event.target.value)} className={fieldClass} />
          </Field>
        </div>
        <fieldset aria-describedby={tried && problems.areas ? `${idBase}-areas-note` : undefined}>
          <legend className="text-[13px] leading-5 font-semibold text-[#0a285a]">{t("team.areasLabel")}</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {TEAM_AREAS.map((area, index) => (
              <label key={area} className="flex items-start gap-2.5 rounded-xl border border-[#e3e8f0] px-3 py-2.5 text-[13px] text-[#0a285a] has-[:checked]:border-[#0a285a] has-[:checked]:bg-[#f4f7fb]">
                <input
                  id={index === 0 ? `${idBase}-areas` : undefined}
                  type="checkbox"
                  checked={areas.includes(area)}
                  onChange={event => toggle(area, event.target.checked)}
                  className="mt-0.5 size-4 shrink-0 accent-[#0a285a]"
                />
                <span className="min-w-0">
                  <span className="block font-semibold">{t(`team.area.${area}` as MessageKey)}</span>
                  <span className="block text-[12px] leading-5 ink-muted">{t(`team.area.${area}Note` as MessageKey)}</span>
                </span>
              </label>
            ))}
          </div>
          {tried && problems.areas ? <p id={`${idBase}-areas-note`} className="mt-1.5 text-[12px] leading-5 font-semibold text-[#8c2f22]">{t(problems.areas)}</p> : null}
        </fieldset>
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={pending} className={buttonClass.primary}>
            {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}{t("team.saveRole")}
          </button>
          <button type="button" onClick={onDone} className={buttonClass.secondary}>{t("team.cancel")}</button>
        </div>
      </form>
    </Card>
  );
}
