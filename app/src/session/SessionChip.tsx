/**
 * The running time of the session as `H:MM:SS`, re-rendered every second.
 *
 * Every epoch reading comes from the SERVER (lib/session.ts): the format
 * is zone-less, so a browser in another timezone than the server would
 * otherwise show a runtime that is hours off. PAUSED time is deducted and the
 * clock STANDS while a pause runs — the number on the chip is the time
 * played, which is what makes a pause mean something. An ENDED session freezes
 * at its `ended` (the chip is gone by then, but a cache race must not tick
 * backwards).
 */
function useElapsedLabel(session: SessionResponse): string | undefined {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  return sessionElapsedLabel(session, nowMs);
}

/**
 * The chip's GEOMETRY — identical in every state: same slot, same height,
 * same radius, same paddings, same font size.
 * Only the colours below and the content inside change, so the switch from
 * the start action to the running clock never makes the topbar jump. From
 * xl up a minimum width holds the states at a comparable size; below that the
 * row is too tight to reserve width (reserving from lg, which is exactly where
 * the nav trio appears, leaves the row no slack on CI's wider font metrics),
 * and the clock's tabular numbers alone keep
 * a second's tick from re-flowing anything.
 */
const SESSION_CHIP_BASE =
  "inline-flex min-h-8 flex-none items-center justify-center gap-2 rounded-full border px-3 py-[3px] text-[13px] xl:min-w-[8.5rem] focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none";

/** Tone per state — the colour IS the state, never the only information. */
const SESSION_CHIP_TONE = {
  // The invitation: the brass accent, the strongest tone in the chrome.
  start:
    "border-primary bg-primary font-semibold text-primary-foreground hover:bg-primary-hover hover:border-primary-hover",
  // A session is running: brass, but quiet — nothing to decide, just present.
  running:
    "border-[color-mix(in_srgb,var(--primary)_45%,transparent)] bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] text-primary hover:border-primary hover:bg-[color-mix(in_srgb,var(--primary)_16%,transparent)] hover:text-primary-hover",
  // Paused: the SAME chip, dimmed — the session has not gone
  // anywhere, it just does not count right now. Muted instead of brass, so
  // running and paused are told apart at a glance; the standing clock and
  // the aria-label carry the state itself.
  paused:
    "border-input bg-transparent text-muted-foreground hover:border-border hover:text-body-secondary",
  // The query failed: dimmed and inert — it is neither live nor an offer.
  error: "border-input bg-transparent text-muted-foreground",
} as const;

/** Which of the chip's states the session query puts it in. */
type SessionChipState = "hidden" | "start" | "running" | "error";

/**
 * The chip's state, straight from the server's answer — and from nothing
 * else:
 *
 *   running — a session came back, ended or not decided by the server.
 *   start   — EXACTLY the answer `null` ("nothing running"). Never while the
 *             query is pending (the chip would flash an offer into a running
 *             session) and never when it failed.
 *   error   — the query failed. Without it a broken lookup looks exactly
 *             like "nothing running", and the chrome offers a start that
 *             cannot work.
 *   hidden  — pending, or a route that offers neither.
 */
function sessionChipState({
  session,
  offersStart,
  showsError,
}: {
  session: { data: SessionResponse | null | undefined; isError: boolean };
  offersStart: boolean;
  showsError: boolean;
}): SessionChipState {
  if (session.data !== undefined && session.data !== null) return "running";
  if (session.isError) return showsError ? "error" : "hidden";
  if (session.data === null) return offersStart ? "start" : "hidden";
  return "hidden";
}

/**
 * The brass dot: it pulses only where motion is welcome (quality floor). While
 * the session is PAUSED it stops pulsing and loses the accent — a standing
 * clock next to a pulsing dot would read as "still counting".
 */
function SessionDot({ paused = false }: { paused?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-[7px] flex-none rounded-full",
        paused ? "bg-muted-foreground" : "bg-primary motion-safe:animate-pulse",
      )}
    />
  );
}

/**
 * THE session control: ONE chip, one slot, every state. The element stays;
 * only what it says and which colour it wears change:
 *
 *   start   — the start action. One click starts a NEW session and enters
 *             /live; there is no resume action.
 *   running — dot + H:MM:SS. Off /live a click goes back into the session;
 *             ON /live it opens the session actions (pause, end, and discard
 *             while the session is still empty), which as three separate
 *             topbar buttons would overflow the row at medium widths.
 *   error   — an unknown-status label, dimmed and inert. Neither live nor an
 *             offer, and it costs the row no second element.
 *
 * The accessible name always carries the STATE plus the running time — the
 * colour alone is not information.
 */
function SessionChip({
  campaign,
  session,
  state,
  mode,
}: {
  campaign: string;
  session: SessionResponse | undefined;
  state: SessionChipState;
  mode: "link" | "menu";
}) {
  const t = useT();
  if (state === "hidden") return null;
  if (state === "error") {
    return (
      <span
        role="status"
        aria-label={t("session.status.unknown.aria")}
        data-session-chip="error"
        className={cn(SESSION_CHIP_BASE, SESSION_CHIP_TONE.error)}
      >
        {t("session.status.unknown")}
      </span>
    );
  }
  if (state === "start" || session === undefined) {
    return <SessionStartChip campaign={campaign} />;
  }
  return (
    <SessionRunningChip campaign={campaign} session={session} mode={mode} />
  );
}

/** The running states of the chip — link off /live, menu on it. */
function SessionRunningChip({
  campaign,
  session,
  mode,
}: {
  campaign: string;
  session: SessionResponse;
  mode: "link" | "menu";
}) {
  const t = useT();
  const elapsed = useElapsedLabel(session);
  // The state is part of the accessible name — the dimmed colour alone is not
  // information (quality floor).
  const paused = sessionIsPaused(session);
  const state = t(paused ? "session.state.paused" : "session.state.running");
  const label =
    elapsed === undefined
      ? state
      : t("session.state.withElapsed", { state, elapsed });

  if (mode === "link") {
    return (
      <Link
        to={`/campaigns/${campaign}/live`}
        aria-label={t("session.chip.link.aria", { label })}
        data-session-chip={paused ? "paused" : "running"}
        className={cn(
          SESSION_CHIP_BASE,
          paused ? SESSION_CHIP_TONE.paused : SESSION_CHIP_TONE.running,
        )}
      >
        <SessionDot paused={paused} />
        <span className="font-mono tabular-nums">
          {elapsed ??
            t(paused ? "session.short.paused" : "session.short.running")}
        </span>
      </Link>
    );
  }
  return (
    <SessionMenuChip
      campaign={campaign}
      session={session}
      label={label}
      elapsed={elapsed}
      paused={paused}
    />
  );
}

/**
 * The chip in its start state: starts a NEW session and navigates to the live
 * mode. ONE click, always, and always the same label — ending a session is
 * final, so a start after an ended evening opens the next session of the day
 * instead of re-opening the closed one. There is no resume action.
 *
 * A start can still answer 409 `session_running` — an OLDER session was never
 * ended. The live view is the place that asks about it, so the click
 * navigates there.
 */
function SessionStartChip({ campaign }: { campaign: string }) {
  const t = useT();
  const navigate = useNavigate();
  const toLive = () => void navigate(`/campaigns/${campaign}/live`);
  const { enter, entering, conflict, failed } = useSessionStartFlow(
    campaign,
    toLive,
  );
  const label = t("session.start");
  return (
    <button
      type="button"
      disabled={entering}
      aria-label={label}
      data-session-chip="start"
      onClick={() => {
        if (conflict === "session_running") toLive();
        else enter();
      }}
      title={
        failed
          ? t("session.start.failed")
          : conflict === "session_running"
            ? t("session.start.olderRunning")
            : undefined
      }
      className={cn(
        SESSION_CHIP_BASE,
        SESSION_CHIP_TONE.start,
        "disabled:pointer-events-none disabled:opacity-60",
      )}
    >
      <Play aria-hidden size={13} className="flex-none fill-current" />
      {label}
    </button>
  );
}

/**
 * The chip in menu mode. The discard confirmation lives OUTSIDE the menu
 * (Radix closes the menu on select), so its dialog state sits here.
 */
function SessionMenuChip({
  campaign,
  session,
  label,
  elapsed,
  paused,
}: {
  campaign: string;
  session: SessionResponse;
  label: string;
  elapsed: string | undefined;
  paused: boolean;
}) {
  const t = useT();
  const navigate = useNavigate();
  const [discardOpen, setDiscardOpen] = useState(false);
  // ONE entry, two directions: the pause endpoints open and
  // close a `pauses` interval in the session — the log row comes with it, and
  // the runtime really stops instead of only being annotated.
  const pause = useSessionWrite(campaign, () =>
    paused ? continueSession(campaign) : pauseSession(campaign),
  );
  // Ending a session leads into the review, not back to the chapter overview
  // (prototype: endSession → review) — the harvest is the next step.
  const end = useSessionWrite(
    campaign,
    () => endSession(campaign),
    () => void navigate(`/campaigns/${campaign}/review`),
  );
  const busy = pause.isPending || end.isPending;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t("session.chip.menu.aria", { label })}
          disabled={busy}
          data-session-chip={paused ? "paused" : "running"}
          className={cn(
            SESSION_CHIP_BASE,
            paused ? SESSION_CHIP_TONE.paused : SESSION_CHIP_TONE.running,
          )}
        >
          <SessionDot paused={paused} />
          <span className="font-mono tabular-nums">
            {elapsed ??
              t(paused ? "session.short.paused" : "session.short.running")}
          </span>
          <ChevronDown aria-hidden size={13} className="flex-none opacity-70" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[210px] text-[13px]">
          <DropdownMenuItem onSelect={() => pause.mutate()}>
            {paused ? (
              <Play
                aria-hidden
                size={14}
                className="flex-none text-muted-foreground"
              />
            ) : (
              <Pause
                aria-hidden
                size={14}
                className="flex-none text-muted-foreground"
              />
            )}
            {t(paused ? "session.menu.continue" : "session.menu.pause")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => end.mutate()}>
            <Square
              aria-hidden
              size={14}
              className="flex-none text-muted-foreground"
            />
            {t("session.menu.end")}
          </DropdownMenuItem>
          {/* Only while the session is EMPTY — the mis-click's undo, gone
              the moment the evening has content. */}
          {sessionIsEmpty(session) && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-muted-foreground"
                onSelect={() => setDiscardOpen(true)}
              >
                <Trash2 aria-hidden size={14} className="flex-none" />
                {t("session.menu.discard")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {(pause.isError || end.isError) && (
        <span className="flex-none text-[12.5px] text-destructive">
          {t("session.write.failed")}
        </span>
      )}
      <DiscardSessionDialog
        campaign={campaign}
        open={discardOpen}
        onOpenChange={setDiscardOpen}
      />
    </>
  );
}

/**
 * Below md the topbar is not the chrome, so the session gets
 * its own slim row — carrying the very SAME chip, in link mode: there is no
 * mobile live mode (UI-BRIEF §4), so the way back into the session is the only
 * action mobile needs. Mobile is for looking things up and throwing ideas in,
 * and this is exactly the way back out of a lookup.
 */
function MobileSessionRow({
  campaign,
  session,
}: {
  campaign: string;
  session: SessionResponse;
}) {
  const t = useT();
  return (
    <div className="flex min-h-11 flex-none items-center gap-2.5 border-b border-border bg-panel-deep px-4 md:hidden">
      <SessionChip
        campaign={campaign}
        session={session}
        state="running"
        mode="link"
      />
      <span className="ml-auto text-[13px] text-body-secondary">
        {t("topbar.session.back")}
      </span>
    </div>
  );
}


/**
 * The discard action: deletes the session that has nothing in it — the undo
 * of a start that was a mis-click. It lives in the session menu (last entry,
 * dimmed), below the end action, which stays THE way out of a session that
 * happened.
 *
 * It deletes a session, so it asks first. The confirmation names the consequence
 * instead of asking for a bare yes/no — that is the only thing worth reading here.
 * After the discard nothing is live any more, so the chapter overview is where the DM
 * lands (the live route without a session would only show its empty state).
 */
function DiscardSessionDialog({
  campaign,
  open,
  onOpenChange,
}: {
  campaign: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const discard = useSessionDiscard(campaign, () => {
    onOpenChange(false);
    void navigate(`/campaigns/${campaign}`);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{t("session.discard.title")}</DialogTitle>
        <DialogDescription>
          {t("session.discard.description")}
        </DialogDescription>
        {discard.isError && (
          <p className="mt-3 text-[12.5px] text-destructive">
            {t("session.discard.failed")}
          </p>
        )}
        <div className="mt-4 flex items-center justify-end gap-2">
          <DialogClose asChild>
            <Button
              type="button"
              variant="outline"
              className="h-auto border-input bg-transparent px-3 py-1.5 text-[12.5px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground"
            >
              {t("common.cancel")}
            </Button>
          </DialogClose>
          <Button
            type="button"
            disabled={discard.isPending}
            onClick={() => discard.mutate()}
            className="h-auto px-3.5 py-1.5 text-[12.5px] font-semibold"
          >
            {t("common.discard")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

