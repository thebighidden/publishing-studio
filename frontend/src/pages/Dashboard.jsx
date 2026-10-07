/* The Dashboard: how the posts we published are actually doing.
 *
 * Every number on this page was read off a phone screen by the collector in
 * app/publishing/metrics.py, and the page is built to never flatter that data.
 * Two rules from the backend are honoured in the markup, not just in the API:
 *
 *   * a counter the screen did not show is `null`, and renders as an em dash
 *     with an explanation -- never as 0, because "nobody liked it" and "we
 *     could not see it" are different facts;
 *   * a post with no reading at all renders as "not measured", so an unread
 *     post can never be mistaken for a dead one.
 *
 * Approximate readings ("1.2K likes") are marked wherever they appear, because
 * they are the right order of magnitude but cannot prove a delta of one.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  BadgeCheck,
  CircleHelp,
  Eye,
  Heart,
  Image as ImageIcon,
  MessageCircle,
  Play,
  RefreshCw,
  Repeat2,
  ScanEye,
  Sparkles,
  TriangleAlert,
  Zap,
} from "lucide-react";
import { api, useResource } from "../api.js";
import { ago, when } from "../ui.jsx";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const nf = new Intl.NumberFormat();

export default function Dashboard({ events, bump }) {
  // A reading landing is the one thing that changes this page on its own, so it
  // is what re-fetches it. Counting the events is enough of a dependency.
  const readings = useMemo(
    () => events.filter((e) => e.kind === "metrics.collected" || e.kind === "metrics.missed").length,
    [events]
  );

  const { data: summary, reload: reloadSummary } = useResource("/api/metrics/summary", [bump, readings]);
  const { data: posts, reload: reloadPosts } = useResource("/api/metrics/posts?limit=60", [bump, readings]);
  const { data: overview } = useResource("/api/overview", [bump]);
  const { data: runs } = useResource("/api/runs?limit=6", [bump]);

  const [openPost, setOpenPost] = useState(null);
  const [busyPost, setBusyPost] = useState(null);
  const [refusal, setRefusal] = useState(null);

  const collect = async (postId) => {
    setBusyPost(postId);
    setRefusal(null);
    try {
      await api.post(`/api/metrics/posts/${postId}/collect`);
    } catch (err) {
      // A guard said no before any phone was touched -- show why, verbatim.
      setRefusal({ postId, message: err.message });
    } finally {
      setBusyPost(null);
    }
  };

  const reloadAll = () => {
    reloadSummary();
    reloadPosts();
  };

  const today = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());

  const collecting = events.length
    ? [...events].reverse().find((e) => e.kind.startsWith("metrics."))
    : null;
  const liveCollection =
    collecting && collecting.kind !== "metrics.collected" && collecting.kind !== "metrics.missed"
      ? collecting
      : null;

  return (
    <TooltipProvider>
      <div className="ui space-y-5">
        {/* ---------------------------------------------------------------- */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
              {today}
            </div>
            <h1 className="mt-1.5 font-serif text-3xl leading-tight font-semibold tracking-tight">
              How your posts are performing.
            </h1>
            <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">
              Likes, comments and views read directly off the phone that published each
              post. No platform API, and nothing here is estimated.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {summary?.pending_collection > 0 && (
              <Badge variant="outline" className="gap-1.5 py-1">
                <ScanEye className="size-3.5" />
                {summary.pending_collection} due for a reading
              </Badge>
            )}
            <Badge
              variant={summary?.auto_collect ? "secondary" : "outline"}
              className={cn("gap-1.5 py-1", !summary?.auto_collect && "text-warning-ink")}
            >
              <Activity className="size-3.5" />
              {summary?.auto_collect ? "Auto-collecting" : "Collection paused"}
            </Badge>
            <Button variant="outline" size="sm" onClick={reloadAll}>
              <RefreshCw />
              Refresh
            </Button>
          </div>
        </div>

        {liveCollection && (
          <div className="flex items-center gap-2.5 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5 text-xs">
            <ScanEye className="size-4 shrink-0 animate-pulse text-primary-ink" />
            <span className="font-medium">Reading a post on the phone right now.</span>
            <span className="truncate text-muted-foreground">
              {liveCollection.detail || liveCollection.action || liveCollection.kind}
            </span>
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <HeadlineCard
            icon={Zap}
            label="Interactions"
            value={summary?.interactions}
            summary={summary}
            hint="Likes, comments and reposts added together, across every post we have managed to read."
            accent
          />
          <HeadlineCard
            icon={Heart}
            label="Likes"
            value={summary?.likes}
            summary={summary}
            hint="The sum of the most recent like count seen on each measured post."
          />
          <HeadlineCard
            icon={MessageCircle}
            label="Comments"
            value={summary?.comments}
            summary={summary}
            hint="Comment counts as printed on the post, not a count of comment rows."
          />
          <HeadlineCard
            icon={Eye}
            label="Views"
            value={summary?.views}
            summary={summary}
            hint="Only posts whose screen showed a view counter contribute here."
            footer={
              summary &&
              (summary.engagement_rate !== null ? (
                <span>
                  <b className="text-foreground">
                    {(summary.engagement_rate * 100).toFixed(1)}%
                  </b>{" "}
                  engagement across the{" "}
                  <b className="text-foreground">{summary.engagement_basis_posts}</b>{" "}
                  {summary.engagement_basis_posts === 1 ? "post" : "posts"} that showed
                  a view count
                </span>
              ) : (
                <span>No view counts observed, so no engagement rate is reported</span>
              ))
            }
          />
        </div>

        {summary?.contains_approximate && (
          <div className="flex items-start gap-2.5 rounded-xl border border-warning/40 bg-warning/5 px-4 py-3 text-xs">
            <TriangleAlert className="mt-px size-4 shrink-0 text-warning-ink" />
            <span className="text-muted-foreground">
              Some of these totals include an abbreviated reading such as{" "}
              <span className="font-mono">1.2K</span>. Those figures are the right order of
              magnitude but cannot prove a change of one, and are marked{" "}
              <span className="font-semibold text-foreground">approx</span> in the table
              below.
            </span>
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle>Published posts</CardTitle>
            <CardDescription>
              {summary
                ? `${summary.measured_posts} of ${summary.published_posts} measured` +
                  (summary.unmeasured_posts
                    ? ` · ${summary.unmeasured_posts} still waiting for a first reading`
                    : "")
                : "Loading performance…"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!posts ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : !posts.length ? (
              <EmptyState
                icon={Sparkles}
                title="Nothing has been published yet"
                body="Once a post goes out and the studio confirms it live, its likes and comments will be read back here."
                action={
                  <Button asChild size="sm">
                    <Link to="/campaigns">Open campaigns</Link>
                  </Button>
                }
              />
            ) : (
              <div className="-mx-2 overflow-x-auto">
                <table className="w-full min-w-[820px] border-collapse text-sm">
                  <thead>
                    <tr className="text-[10px] font-bold tracking-[0.1em] text-muted-foreground uppercase">
                      <th className="px-2 pb-3 text-left font-bold">Post</th>
                      <th className="px-2 pb-3 text-right font-bold">Likes</th>
                      <th className="px-2 pb-3 text-right font-bold">Comments</th>
                      <th className="px-2 pb-3 text-right font-bold">Views</th>
                      <th className="px-2 pb-3 text-right font-bold">Reposts</th>
                      <th className="px-2 pb-3 text-left font-bold">Last read</th>
                      <th className="px-2 pb-3 text-right font-bold"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {posts.map((row) => (
                      <PostRow
                        key={row.post_id}
                        row={row}
                        busy={busyPost === row.post_id}
                        refusal={refusal?.postId === row.post_id ? refusal.message : null}
                        onCollect={() => collect(row.post_id)}
                        onOpen={() => setOpenPost(row.post_id)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ---------------------------------------------------------------- */}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle>Publishing outcomes</CardTitle>
              <CardDescription>
                What the studio proved about each dispatch, not what it attempted.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-2.5">
                <OutcomeTile
                  icon={BadgeCheck}
                  label="Confirmed"
                  value={overview?.runs.confirmed}
                  tone="text-success-ink"
                />
                <OutcomeTile
                  icon={CircleHelp}
                  label="Uncertain"
                  value={overview?.runs.uncertain}
                  tone="text-warning-ink"
                />
                <OutcomeTile
                  icon={TriangleAlert}
                  label="Failed"
                  value={overview?.runs.failed}
                  tone="text-destructive"
                />
              </div>

              <Separator />

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold">Latest runs</span>
                  <Link
                    to="/runs"
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    View all
                  </Link>
                </div>
                {!runs?.length ? (
                  <p className="py-3 text-xs text-muted-foreground">No runs yet.</p>
                ) : (
                  runs.map((run) => (
                    <Link
                      key={run.id}
                      to={`/runs/${run.id}`}
                      className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-accent"
                    >
                      <span
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          outcomeDot(run.outcome)
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium">
                          {run.post_title || run.goal}
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          @{run.handle} · {run.phone_name} · {ago(run.created_at)}
                        </span>
                      </span>
                      <Badge variant="outline" className="shrink-0 text-[10px]">
                        {run.outcome || run.status}
                      </Badge>
                    </Link>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="min-w-0">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Studio activity
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    events.length ? "animate-pulse bg-success" : "bg-muted-foreground"
                  )}
                />
              </CardTitle>
              <CardDescription>Every step the studio takes, as it takes it.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="max-h-[340px] space-y-px overflow-y-auto font-mono text-[11px]">
                {!events.length ? (
                  <p className="py-6 text-center text-xs text-muted-foreground">
                    Waiting for activity…
                  </p>
                ) : (
                  [...events]
                    .reverse()
                    .slice(0, 80)
                    .map((event, i) => (
                      <div key={i} className="flex gap-2 border-b py-1.5 last:border-0">
                        {/* Full muted-foreground, not /70: at 11px the faded
                            variant measured 2.72:1 in the light theme, and the
                            timestamp is how an operator tells a live event from
                            one that arrived ten minutes ago. */}
                        <span className="shrink-0 text-muted-foreground">
                          {new Date(event.at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </span>
                        <span
                          className={cn(
                            "shrink-0 font-semibold",
                            event.kind.startsWith("metrics.") ? "text-primary-ink" : "text-foreground"
                          )}
                        >
                          {event.kind}
                        </span>
                        <span className="min-w-0 flex-1 break-words text-muted-foreground">
                          {summarise(event)}
                        </span>
                      </div>
                    ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <PostHistoryDialog postId={openPost} onClose={() => setOpenPost(null)} />
      </div>
    </TooltipProvider>
  );
}

/* ------------------------------------------------------------------------ */
/* headline cards                                                            */
/* ------------------------------------------------------------------------ */

function HeadlineCard({ icon: Icon, label, value, summary, hint, footer, accent }) {
  const measured = summary?.measured_posts ?? 0;
  const published = summary?.published_posts ?? 0;

  return (
    <Card className={cn("gap-0", accent && "border-primary/30 bg-primary/[0.03]")}>
      <CardContent className="px-5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            {label}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Icon className={cn("size-4", accent ? "text-primary-ink" : "text-muted-foreground")} />
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-60">{hint}</TooltipContent>
          </Tooltip>
        </div>

        <div className="mt-2.5 font-serif text-[30px] leading-none font-semibold tracking-tight">
          {summary ? nf.format(value ?? 0) : <Skeleton className="h-7 w-20" />}
        </div>

        {/* Every total carries its own denominator. A big number drawn from one
         * measured post out of forty is a lie told with a true figure. */}
        <div className="mt-2 text-[11px] text-muted-foreground">
          {footer || (
            <>
              across{" "}
              <span className="font-semibold text-foreground">
                {measured} of {published}
              </span>{" "}
              published {published === 1 ? "post" : "posts"}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function OutcomeTile({ icon: Icon, label, value, tone }) {
  return (
    <div className="rounded-xl border bg-muted/30 px-3 py-3">
      <Icon className={cn("size-4", tone)} />
      <div className="mt-2 font-serif text-2xl leading-none font-semibold">
        {value ?? "—"}
      </div>
      <div className="mt-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* the post table                                                            */
/* ------------------------------------------------------------------------ */

function PostRow({ row, busy, refusal, onCollect, onOpen }) {
  const latest = row.latest;
  const delta = row.since_first_reading || {};

  return (
    <>
      <tr className="border-t align-middle transition-colors hover:bg-accent/40">
        <td className="max-w-[320px] px-2 py-3">
          <div className="flex items-center gap-3">
            <Thumb row={row} />
            <div className="min-w-0">
              <button
                onClick={onOpen}
                className="block max-w-full truncate text-left text-[13px] font-semibold hover:underline"
                title={row.title || row.caption}
              >
                {row.title || row.caption || "Untitled post"}
              </button>
              <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <PlatformMark platform={row.platform} />
                <span className="truncate">@{row.handle || "unknown"}</span>
                <span>·</span>
                <span className="shrink-0">{ago(row.published_at)}</span>
              </div>
            </div>
          </div>
        </td>

        {!latest ? (
          // One cell spanning every counter column: a post nobody has looked at
          // yet must not be drawn as a row of zeros.
          <td colSpan={4} className="px-2 py-3 text-center">
            <NotMeasured row={row} />
          </td>
        ) : (
          <>
            <Counter value={latest.likes} delta={delta.likes} approximate={latest.approximate} raw={latest.raw?.likes} />
            <Counter value={latest.comments} delta={delta.comments} approximate={latest.approximate} raw={latest.raw?.comments} />
            <Counter value={latest.views} delta={delta.views} approximate={latest.approximate} raw={latest.raw?.views} />
            <Counter value={latest.shares} delta={delta.shares} approximate={latest.approximate} raw={latest.raw?.shares} />
          </>
        )}

        <td className="px-2 py-3">
          {!latest ? (
            <span className="text-[11px] text-muted-foreground">—</span>
          ) : (
            <button onClick={onOpen} className="text-left">
              <span className="block text-[11px] font-medium hover:underline">
                {ago(latest.collected_at)}
              </span>
              <span className="block text-[10px] text-muted-foreground">
                {row.readings} reading{row.readings === 1 ? "" : "s"}
                {latest.source === "manual" && " · typed in"}
                {latest.approximate && " · approx"}
              </span>
            </button>
          )}
        </td>

        <td className="px-2 py-3 text-right">
          <div className="flex items-center justify-end gap-1">
            {latest?.screenshot && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <a
                    href={latest.screenshot}
                    target="_blank"
                    rel="noreferrer"
                    className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <ImageIcon className="size-3.5" />
                  </a>
                </TooltipTrigger>
                <TooltipContent>The screen these numbers were read from</TooltipContent>
              </Tooltip>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={onCollect}
              disabled={busy || !row.measurable}
              className="text-[11px]"
            >
              <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
              {busy ? "Reading" : "Read now"}
            </Button>
          </div>
        </td>
      </tr>

      {refusal && (
        <tr>
          <td colSpan={7} className="px-2 pb-3">
            <div className="rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-[11px] text-muted-foreground">
              <span className="font-semibold text-foreground">
                The studio declined to read this post:
              </span>{" "}
              {refusal}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/** Why there are no numbers here. Four states, all different, none of them 0. */
function NotMeasured({ row }) {
  if (!row.measurable) {
    return (
      <span className="text-xs text-muted-foreground italic">
        No phone linked to this account, so nothing can be read
      </span>
    );
  }
  const attempt = row.last_attempt;
  if (!attempt) {
    return <span className="text-xs text-muted-foreground italic">Not measured yet</span>;
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help text-xs text-warning-ink italic">
          Looked {ago(attempt.at)} and found nothing
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72">{attempt.note}</TooltipContent>
    </Tooltip>
  );
}

/** One counter cell. `null` is "the screen did not show this", never zero. */
function Counter({ value, delta, approximate, raw }) {
  if (value === null || value === undefined) {
    return (
      <td className="px-2 py-3 text-right">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-help text-muted-foreground">—</span>
          </TooltipTrigger>
          <TooltipContent className="max-w-56">
            This post's screen did not show the counter, so nothing was recorded. Not
            observed is not the same as zero.
          </TooltipContent>
        </Tooltip>
      </td>
    );
  }

  const body = (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-[13px] font-semibold tabular-nums">{nf.format(value)}</span>
      {approximate && <span className="text-[9px] text-warning-ink">≈</span>}
    </span>
  );

  return (
    <td className="px-2 py-3 text-right">
      {raw ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-help">{body}</span>
          </TooltipTrigger>
          <TooltipContent>
            Read from the screen as <span className="font-mono">{String(raw)}</span>
          </TooltipContent>
        </Tooltip>
      ) : (
        body
      )}
      {typeof delta === "number" && delta !== 0 && (
        <span
          className={cn(
            "ml-1 text-[10px] font-semibold tabular-nums",
            delta > 0 ? "text-success-ink" : "text-destructive"
          )}
        >
          {delta > 0 ? "+" : ""}
          {nf.format(delta)}
        </span>
      )}
    </td>
  );
}

function Thumb({ row }) {
  if (!row.media_url) {
    return (
      <div className="grid size-11 shrink-0 place-items-center rounded-lg border bg-muted/40 text-muted-foreground">
        <ImageIcon className="size-4" />
      </div>
    );
  }
  return (
    <div className="relative size-11 shrink-0 overflow-hidden rounded-lg border bg-muted/40">
      <img src={row.media_url} alt="" className="size-full object-cover" />
      {row.media_kind === "video" && (
        <span className="absolute inset-0 grid place-items-center bg-black/35 text-white">
          <Play className="size-3.5 fill-current" />
        </span>
      )}
    </div>
  );
}

/* lucide dropped its brand glyphs, and a lettered mark is clearer at 11px
 * anyway -- nobody has to squint at a bird to tell which platform this is. */
function PlatformMark({ platform }) {
  return (
    <span
      className={cn(
        "grid h-[15px] shrink-0 place-items-center rounded px-1 text-[9px] font-bold",
        // /10 rather than /15: at 9px the violet on the stronger tint measured
        // 4.38:1 in the light theme, just under AA.
        platform === "instagram"
          ? "bg-primary/10 text-primary-ink"
          : "bg-foreground/10 text-foreground"
      )}
    >
      {platform === "instagram" ? "IG" : "X"}
    </span>
  );
}

/* ------------------------------------------------------------------------ */
/* the reading history                                                       */
/* ------------------------------------------------------------------------ */

function PostHistoryDialog({ postId, onClose }) {
  const { data } = useResource(postId ? `/api/metrics/posts/${postId}` : null, [postId]);

  return (
    <Dialog open={Boolean(postId)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="pr-6 text-left">
            {data?.title || data?.caption?.slice(0, 70) || "Post performance"}
          </DialogTitle>
          <DialogDescription className="text-left">
            {data ? (
              <>
                @{data.handle} · {data.platform} · published {when(data.published_at)}
                {data.campaign_name ? ` · ${data.campaign_name}` : ""}
              </>
            ) : (
              "Loading readings…"
            )}
          </DialogDescription>
        </DialogHeader>

        {!data ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : !data.series.length ? (
          <EmptyState
            icon={ScanEye}
            title="No readings yet"
            body={
              data.measurable
                ? "The collector has not been to this post yet. It is picked up automatically, more often while the post is new."
                : "This post's account is not linked to a phone, so there is no way to read its performance."
            }
          />
        ) : (
          <div className="space-y-3">
            {/* Oldest first, so growth reads top to bottom. */}
            {data.series.map((m) => (
              <div key={m.id} className="rounded-xl border p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold">{when(m.collected_at)}</span>
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className="text-[10px]">
                      {m.source === "device" ? "read off the phone" : "entered by hand"}
                    </Badge>
                    {m.approximate && (
                      <Badge variant="outline" className="border-warning/50 text-[10px] text-warning-ink">
                        approximate
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  <Figure icon={Heart} label="Likes" value={m.likes} raw={m.raw?.likes} />
                  <Figure icon={MessageCircle} label="Comments" value={m.comments} raw={m.raw?.comments} />
                  <Figure icon={Eye} label="Views" value={m.views} raw={m.raw?.views} />
                  <Figure icon={Repeat2} label="Reposts" value={m.shares} raw={m.raw?.shares} />
                </div>

                {m.matched_by?.token && (
                  <p className="mt-3 text-[11px] text-muted-foreground">
                    Identified as our own post by the word{" "}
                    <span className="font-mono text-foreground">{m.matched_by.token}</span>
                    {typeof m.matched_by.slot === "number" &&
                      /* The two platforms are walked differently, and saying
                         "grid position" about a timeline reads as a mistake
                         next to the collector's own note. */
                      (data.platform === "instagram"
                        ? ` at grid position ${m.matched_by.slot}`
                        : ` at timeline row ${m.matched_by.slot}`)}
                    .
                  </p>
                )}
                {m.note && <p className="mt-1.5 text-[11px] text-muted-foreground">{m.note}</p>}

                {m.screenshot && (
                  <a
                    href={m.screenshot}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 block overflow-hidden rounded-lg border"
                  >
                    <img
                      src={m.screenshot}
                      alt="The screen this reading came from"
                      className="max-h-56 w-full object-cover object-top"
                    />
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Figure({ icon: Icon, label, value, raw }) {
  const observed = value !== null && value !== undefined;
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
        <Icon className="size-3" />
        {label}
      </div>
      <div
        className={cn(
          "mt-1 text-lg leading-none font-semibold tabular-nums",
          !observed && "text-muted-foreground"
        )}
        title={raw ? `read as "${raw}"` : undefined}
      >
        {observed ? nf.format(value) : "—"}
      </div>
      {!observed && <div className="mt-0.5 text-[10px] text-muted-foreground">not on screen</div>}
    </div>
  );
}

/* ------------------------------------------------------------------------ */

function EmptyState({ icon: Icon, title, body, action }) {
  return (
    <div className="grid place-items-center gap-2 px-6 py-10 text-center">
      <div className="grid size-10 place-items-center rounded-full border bg-muted/40 text-muted-foreground">
        <Icon className="size-4" />
      </div>
      <div className="text-sm font-semibold">{title}</div>
      <p className="max-w-sm text-xs text-muted-foreground">{body}</p>
      {action}
    </div>
  );
}

function outcomeDot(outcome) {
  if (outcome === "confirmed") return "bg-success";
  if (outcome === "failed") return "bg-destructive";
  if (outcome === "uncertain") return "bg-warning";
  return "bg-primary animate-pulse";
}

function summarise(event) {
  const { kind, at, ...rest } = event;
  return Object.entries(rest)
    .filter(([k]) => !["run_id", "campaign_id", "post_id", "media_id"].includes(k))
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`)
    .join(" ");
}
