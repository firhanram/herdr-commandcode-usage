import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, appHome, exec, theme } from "herdr";

const CACHE = "commandcode-usage:v1";
const REFRESH_MS = 60_000;
const PLANS = {
  "individual-go": { name: "Go", credits: 10 },
  "individual-go-v1": { name: "Go", credits: 10 },
  "individual-goat": { name: "GOAT", credits: 70 },
  "individual-pro": { name: "Pro", credits: 30 },
  "individual-pro-v1": { name: "Pro", credits: 80 },
  "individual-provider": { name: "Provider", credits: 15 },
  "individual-max": { name: "Max", credits: 150 },
  "individual-ultra": { name: "Ultra", credits: 300 },
  "teams-pro": { name: "Teams Pro", credits: 40 },
};

const money = (n) => (typeof n === "number" ? `$${n.toFixed(2)}` : "—");

function tokens(n) {
  if (typeof n !== "number") return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

function wait(ms) {
  if (!Number.isFinite(ms)) return "—";
  if (ms <= 0) return "now";
  const m = Math.floor(ms / 60_000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${Math.max(1, m)}m`;
}

function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function renewal(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const days = Math.max(0, Math.ceil((t - Date.now()) / 86_400_000));
  const d = new Date(t);
  return { date: `${MONTHS[d.getMonth()]} ${d.getDate()}`, days };
}

export default class CommandCodeUsage extends View {
  init(_props, cx) {
    this.data = null;
    this.error = null;
    this.loading = false;
    this.fetchedAt = 0;

    try {
      const cached = JSON.parse(localStorage.getItem(CACHE) ?? "null");
      if (cached?.data) {
        this.data = cached.data;
        this.fetchedAt = cached.fetchedAt ?? 0;
      }
    } catch {}

    cx.timer.every(REFRESH_MS, (cx) => this.refresh(cx));
    this.refresh(cx);
  }

  refresh(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec(`${appHome()}/mods/commandcode-usage/fetch-usage.sh`, [], {
          timeout: 45_000,
        });
        const snap = JSON.parse(r.stdout);
        if (snap?.error) throw new Error(snap.error);
        if (snap?.whoami?.error) {
          throw new Error(snap.whoami.error.message ?? snap.whoami.error.code ?? "unauthorized");
        }
        this.data = snap;
        this.fetchedAt = Date.now();
        this.error = null;
        localStorage.setItem(CACHE, JSON.stringify({ data: snap, fetchedAt: this.fetchedAt }));
      } catch (e) {
        const message = e?.message ?? String(e);
        this.error =
          message === "not-authenticated" ? "not signed in to Command Code" : message;
      } finally {
        this.loading = false;
        cx.notify();
      }
    });
  }

  segments(t, pct, fill) {
    const total = 20;
    const filled = Math.max(pct > 0 ? 1 : 0, Math.round((pct / 100) * total));
    return h_flex()
      .justify_between()
      .w("100%")
      .children(
        Array.from({ length: total }, (_, i) =>
          div().h(6).w(12).rounded(1.5).bg(i < filled ? fill : t.border),
        ),
      );
  }

  limitRow(t, label, pctRaw, resetText, exceeded) {
    const pct = Math.min(100, Math.max(0, pctRaw));
    const fill = exceeded || pct >= 90 ? t.blocked : pct >= 70 ? t.working : t.accent;

    return v_flex()
      .gap(5)
      .child(
        h_flex()
          .justify_between()
          .items_center()
          .child(div().text_color(t.muted).child(label))
          .child(
            div()
              .text_size(13)
              .font_semibold()
              .text_color(exceeded ? t.blocked : t.foreground)
              .child(`${Math.round(pct)}%`),
          ),
      )
      .child(this.segments(t, pct, fill))
      .child(
        div()
          .text_size(10.5)
          .text_color(exceeded ? t.blocked : t.dim)
          .child(exceeded ? "Limit reached" : resetText || " "),
      );
  }

  render(cx) {
    const t = theme();
    const snap = this.data;
    const sub = snap?.subscription?.data ?? null;
    const credits = snap?.credits ?? null;
    const windows = credits?.windowLimits ?? null;
    const summary = snap?.summary ?? null;
    const plan = sub ? (PLANS[sub.planId]?.name ?? sub.planId ?? "Unknown") : null;
    const renew = renewal(sub?.currentPeriodEnd);
    const monthly = credits?.credits?.monthlyCredits;
    const allowance = sub ? (PLANS[sub.planId]?.credits ?? null) : null;
    const monthlyPct = allowance
      ? typeof monthly === "number"
        ? ((allowance - monthly) / allowance) * 100
        : typeof summary?.totalCost === "number"
          ? (summary.totalCost / allowance) * 100
          : null
      : null;
    const sessionList = agents().filter((a) => a.app === "command-code");
    const needs = sessionList.filter((a) => a.status === "blocked").length;

    return v_flex()
      .size_full()
      .p(12)
      .gap(9)
      .bg(t.surface)
      .text_size(12)
      .text_color(t.foreground)
      .overflow_y_scrollbar()
      .child(
        h_flex()
          .items_center()
          .gap(7)
          .child(svg("icons/command-code.svg").size(14))
          .child(div().font_semibold().child("Command Code"))
          .child(div().flex_1())
          .child(
            div()
              .id("usage-refresh")
              .text_color(this.loading ? t.dim : t.muted)
              .hover((s) => s.text_color(t.foreground))
              .when(!this.loading, (el) => el.on_click((_e, cx) => this.refresh(cx)))
              .child(this.loading && !snap ? "…" : "↻"),
          ),
      )
      .when(Boolean(plan), (el) =>
        el.child(
          h_flex()
            .justify_between()
            .items_center()
            .child(
              h_flex()
                .gap(6)
                .items_center()
                .child(div().child(`${plan} plan`))
                .when(sub?.status && sub.status !== "active", (e2) =>
                  e2.child(div().text_size(10.5).text_color(t.blocked).child(sub.status)),
                ),
            )
            .when(Boolean(renew), (e2) =>
              e2.child(
                div()
                  .text_size(10.5)
                  .text_color(t.dim)
                  .child(`renews ${renew.date} · ${renew.days}d left`),
              ),
            ),
        ),
      )
      .child(div().h(1).w("100%").bg(t.border).my(1))
      .children(
        [
          windows?.fiveHour
            ? this.limitRow(
                t,
                "5-hour limit",
                windows.fiveHour.cap > 0 ? (windows.fiveHour.used / windows.fiveHour.cap) * 100 : 0,
                `Resets in ${wait(windows.fiveHour.resetAt - Date.now())}`,
                windows.fiveHour.exceeded,
              )
            : null,
          windows?.weekly
            ? this.limitRow(
                t,
                "Weekly limit",
                windows.weekly.cap > 0 ? (windows.weekly.used / windows.weekly.cap) * 100 : 0,
                `Resets in ${wait(windows.weekly.resetAt - Date.now())}`,
                windows.weekly.exceeded,
              )
            : null,
          monthlyPct != null
            ? this.limitRow(
                t,
                "Monthly limit",
                monthlyPct,
                renew ? `Resets on ${renew.date}` : "",
                false,
              )
            : null,
        ].filter(Boolean),
      )
      .child(div().h(1).w("100%").bg(t.border).my(1))
      .when(Boolean(summary), (el) =>
        el.child(
          v_flex()
            .gap(3)
            .child(
              h_flex()
                .justify_between()
                .child(div().text_color(t.muted).child("This period"))
                .child(div().child(money(summary.totalCost))),
            )
            .child(
              h_flex()
                .justify_between()
                .child(div().text_size(10.5).text_color(t.dim).child(tokens(summary.totalTokens) + " tokens"))
                .child(
                  div()
                    .text_size(10.5)
                    .text_color(t.dim)
                    .child(`${summary.totalCount ?? 0} requests`),
                ),
            ),
        ),
      )
      .when(Boolean(this.error), (el) =>
        el.child(
          div()
            .text_size(10.5)
            .text_color(t.blocked)
            .child(snap ? `stale · ${this.error}` : this.error),
        ),
      )
      .child(
        h_flex()
          .justify_between()
          .text_size(10.5)
          .text_color(t.dim)
          .child(
            div().child(
              sessionList.length === 0
                ? "no sessions"
                : `${sessionList.length} session${sessionList.length === 1 ? "" : "s"}` +
                    (needs ? ` · ${needs} needs you` : ""),
            ),
          )
          .child(div().child(this.fetchedAt ? `${ago(Date.now() - this.fetchedAt)} ago` : "")),
      );
  }
}
