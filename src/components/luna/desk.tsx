import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Moon, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { ControlPlaneSnapshot, TaskStatus } from "@/luna/domain";
import { TASK_PRESETS } from "@/luna/presets";
import {
  cancelTaskFn,
  createTaskFn,
  decideApprovalFn,
  executeTaskFn,
  planTaskFn,
} from "@/luna/server/functions";

const STATUS_LABEL: Record<TaskStatus, string> = {
  draft: "Nháp",
  planned: "Đã lập kế hoạch",
  awaiting_approval: "Chờ duyệt",
  approved: "Đã duyệt",
  rejected: "Từ chối",
  dry_run_completed: "Dry-run xong",
  blocked: "Bị khóa",
  cancelled: "Đã hủy",
};

const FLOW = ["Tác vụ", "Planner", "Duyệt", "Dry-run", "Audit"];

function stamp(iso: string): string {
  return `${iso.replace("T", " ").slice(0, 16)} UTC`;
}

export function LunaDesk({ snapshot }: { snapshot: ControlPlaneSnapshot }) {
  const router = useRouter();
  const createTask = useServerFn(createTaskFn);
  const planTask = useServerFn(planTaskFn);
  const decideApproval = useServerFn(decideApprovalFn);
  const executeTask = useServerFn(executeTaskFn);
  const cancelTask = useServerFn(cancelTaskFn);
  const [goal, setGoal] = useState<string>(TASK_PRESETS[0].goal);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const selected = snapshot.tasks.find((task) => task.id === selectedId) ?? snapshot.tasks[0];
  const approval = snapshot.approvals.find((item) => item.id === selected?.approvalId);
  const canCancel =
    selected !== undefined &&
    !["dry_run_completed", "blocked", "rejected", "cancelled"].includes(selected.status);

  async function after(work: () => Promise<{ ok: boolean; message?: string; taskId?: string }>) {
    setBusy(true);
    try {
      const result = await work();
      setNotice(result.message ?? "");
      if (result.taskId) setSelectedId(result.taskId);
      await router.invalidate();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không gọi được máy chủ.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-ink text-fg">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-6 lg:grid-cols-[17rem_minmax(0,1fr)] lg:px-6 lg:py-10">
        <aside className="flex flex-col gap-6 border-l-4 border-l-amber pl-4 lg:sticky lg:top-8 lg:self-start">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-amber text-amber-ink">
              <Moon className="size-5" aria-hidden="true" />
            </span>
            <div>
              <p className="font-display text-3xl leading-none">Luna</p>
              <p className="mt-1 text-sm text-muted">Phase {snapshot.phase}</p>
            </div>
          </div>
          <p className="text-sm leading-6 text-muted">
            Bàn điều khiển tác vụ cho Zalo và eOffice sau này. Phase này chỉ lập kế hoạch, duyệt và
            dry-run.
          </p>
          <dl className="grid gap-3 text-sm">
            <div className="rounded-2xl border border-line bg-panel px-4 py-3">
              <dt className="text-muted">Firebase</dt>
              <dd className="mt-1 font-medium">{snapshot.adapters.firebase.mode}</dd>
            </div>
            <div className="rounded-2xl border border-line bg-panel px-4 py-3">
              <dt className="text-muted">Model</dt>
              <dd className="mt-1 font-medium">{snapshot.adapters.models.activeProvider}</dd>
            </div>
            <div className="rounded-2xl border border-line bg-panel px-4 py-3">
              <dt className="text-muted">Browser</dt>
              <dd className="mt-1 font-medium">mock · stub đã đăng ký</dd>
            </div>
          </dl>
        </aside>

        <main className="flex min-w-0 flex-col gap-8">
          <header className="flex flex-col gap-4">
            <p className="text-xs font-medium tracking-widest text-amber uppercase">
              Khóa an toàn đang bật
            </p>
            <h1 className="font-display text-4xl leading-tight sm:text-5xl">
              Không có tác động production.
            </h1>
            <p className="max-w-2xl text-base leading-7 text-muted">
              Luna từ chối đăng nhập, gửi tin, ghi Firebase thật và gọi model trả phí. Mọi bước nhạy
              cảm đi qua cổng duyệt, rồi vẫn chỉ được mô phỏng.
            </p>
          </header>

          <section
            className="rounded-2xl border border-line bg-panel-2 p-4 sm:p-5"
            aria-label="Khóa phase"
          >
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-amber" aria-hidden="true" />
              <div className="text-sm leading-6">
                <p className="font-medium">Phase lock không tắt được từ giao diện này.</p>
                <p className="mt-1 text-muted">
                  API không nhận chế độ live. Playwright, Skyvern và Browser Use được khai báo nhưng
                  orchestrator luôn ép về mock.
                </p>
              </div>
            </div>
          </section>

          <ol className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {FLOW.map((label, index) => (
              <li key={label} className="rounded-2xl border border-line bg-panel px-3 py-3 text-sm">
                <span className="text-amber">0{index + 1}</span>
                <span className="mt-1 block font-medium">{label}</span>
              </li>
            ))}
          </ol>

          <section className="grid gap-3 sm:grid-cols-2">
            {snapshot.modules.map((module) => (
              <article key={module.id} className="rounded-2xl border border-line bg-panel p-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-display text-2xl">{module.name}</h2>
                  <span
                    className={
                      module.state === "locked"
                        ? "rounded-full bg-amber px-3 py-1 text-xs font-medium text-amber-ink"
                        : "rounded-full border border-line px-3 py-1 text-xs text-muted"
                    }
                  >
                    {module.state}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-muted">{module.detail}</p>
              </article>
            ))}
          </section>

          <section className="rounded-2xl border border-line bg-panel p-4 sm:p-5">
            <h2 className="font-display text-3xl">Tác vụ</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Chọn một mẫu hoặc viết mục tiêu. Bộ nhớ nằm trong tiến trình máy chủ và sẽ mất khi
              khởi động lại.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {TASK_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="min-h-11 rounded-xl border border-line px-3 text-sm text-fg hover:border-amber"
                  onClick={() => setGoal(preset.goal)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <label className="mt-4 block text-sm text-muted" htmlFor="goal">
              Mục tiêu
            </label>
            <textarea
              id="goal"
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              rows={3}
              className="mt-2 w-full resize-y rounded-2xl border border-line bg-ink px-4 py-3 text-sm leading-6 text-fg outline-none focus-visible:border-amber"
            />
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                className="min-h-11 rounded-xl bg-amber px-4 text-sm font-medium text-amber-ink disabled:opacity-50"
                onClick={() =>
                  void after(async () => {
                    const result = await createTask({ data: { goal, title: "" } });
                    return {
                      ok: result.ok,
                      message: result.ok ? "Đã tạo tác vụ nháp." : result.message,
                      taskId: result.ok ? result.data.id : undefined,
                    };
                  })
                }
              >
                Tạo tác vụ
              </button>
              <span className="self-center text-sm text-muted" aria-live="polite">
                {busy ? "Đang xử lý…" : notice}
              </span>
            </div>

            {snapshot.tasks.length === 0 ? (
              <p className="mt-6 text-sm text-muted">Chưa có tác vụ.</p>
            ) : (
              <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
                <ul className="flex flex-col gap-2">
                  {snapshot.tasks.map((task) => (
                    <li key={task.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(task.id)}
                        className={
                          selected?.id === task.id
                            ? "w-full min-h-11 rounded-2xl border border-amber bg-panel-2 px-3 py-3 text-left"
                            : "w-full min-h-11 rounded-2xl border border-line px-3 py-3 text-left hover:border-amber"
                        }
                      >
                        <span className="block text-sm font-medium break-words">{task.title}</span>
                        <span className="mt-1 block text-xs text-muted">
                          {STATUS_LABEL[task.status]}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>

                {selected ? (
                  <div className="min-w-0 rounded-2xl border border-line bg-ink p-4">
                    <p className="text-xs text-muted">{selected.mode}</p>
                    <h3 className="mt-1 font-display text-2xl break-words">{selected.title}</h3>
                    <p className="mt-2 text-sm leading-6 break-words text-muted">{selected.goal}</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy || selected.status !== "draft"}
                        className="min-h-11 rounded-xl border border-line px-4 text-sm disabled:opacity-50"
                        onClick={() =>
                          void after(async () => {
                            const result = await planTask({ data: { taskId: selected.id } });
                            return {
                              ok: result.ok,
                              message: result.ok ? "Đã lập kế hoạch." : result.message,
                              taskId: selected.id,
                            };
                          })
                        }
                      >
                        Lập kế hoạch
                      </button>
                      <button
                        type="button"
                        disabled={
                          busy || (selected.status !== "planned" && selected.status !== "approved")
                        }
                        className="min-h-11 rounded-xl bg-amber px-4 text-sm font-medium text-amber-ink disabled:opacity-50"
                        onClick={() =>
                          void after(async () => {
                            const result = await executeTask({ data: { taskId: selected.id } });
                            return {
                              ok: result.ok,
                              message: result.ok ? "Dry-run xong." : result.message,
                              taskId: selected.id,
                            };
                          })
                        }
                      >
                        Chạy dry-run
                      </button>
                      <button
                        type="button"
                        disabled={busy || !canCancel}
                        className="min-h-11 rounded-xl border border-line px-4 text-sm disabled:opacity-50"
                        onClick={() =>
                          void after(async () => {
                            const result = await cancelTask({ data: { taskId: selected.id } });
                            return {
                              ok: result.ok,
                              message: result.ok ? "Đã hủy." : result.message,
                              taskId: selected.id,
                            };
                          })
                        }
                      >
                        Hủy
                      </button>
                    </div>

                    {approval?.status === "pending" ? (
                      <div className="mt-4 rounded-2xl border border-line bg-panel p-4">
                        <p className="text-sm font-medium">Cần duyệt trước dry-run</p>
                        <p className="mt-1 text-sm leading-6 text-muted">{approval.reason}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            className="min-h-11 rounded-xl bg-amber px-4 text-sm font-medium text-amber-ink disabled:opacity-50"
                            onClick={() =>
                              void after(async () => {
                                const result = await decideApproval({
                                  data: {
                                    approvalId: approval.id,
                                    decision: "approved",
                                    note: "Duyệt dry-run, không cho live.",
                                  },
                                });
                                return {
                                  ok: result.ok,
                                  message: result.ok ? "Đã duyệt dry-run." : result.message,
                                  taskId: selected.id,
                                };
                              })
                            }
                          >
                            Duyệt dry-run
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            className="min-h-11 rounded-xl border border-line px-4 text-sm disabled:opacity-50"
                            onClick={() =>
                              void after(async () => {
                                const result = await decideApproval({
                                  data: {
                                    approvalId: approval.id,
                                    decision: "rejected",
                                    note: "Không làm.",
                                  },
                                });
                                return {
                                  ok: result.ok,
                                  message: result.ok ? "Đã từ chối." : result.message,
                                  taskId: selected.id,
                                };
                              })
                            }
                          >
                            Từ chối
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {selected.plan ? (
                      <ol className="mt-4 flex flex-col gap-3">
                        {selected.plan.steps.map((step) => (
                          <li key={step.id} className="rounded-2xl border border-line px-3 py-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-sm font-medium">{step.title}</p>
                              <span className="text-xs text-amber">{step.sensitivity}</span>
                            </div>
                            <p className="mt-1 text-sm leading-6 text-muted">{step.detail}</p>
                          </li>
                        ))}
                      </ol>
                    ) : null}

                    {selected.lastReport ? (
                      <div className="mt-4">
                        <p className="text-sm font-medium">Kết quả {selected.lastReport.outcome}</p>
                        <ul className="mt-2 flex flex-col gap-2">
                          {selected.lastReport.steps.map((step) => (
                            <li
                              key={step.stepId}
                              className="text-sm leading-6 break-words text-muted"
                            >
                              <span className="text-fg">{step.outcome}</span> · {step.summary}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}
          </section>

          <section>
            <h2 className="font-display text-3xl">Nhật ký</h2>
            {snapshot.audit.length === 0 ? (
              <p className="mt-3 text-sm text-muted">
                Chưa có sự kiện. Mọi bản ghi sau này đều là dry-run.
              </p>
            ) : (
              <ul className="mt-4 flex flex-col gap-2">
                {snapshot.audit.map((event) => (
                  <li key={event.id} className="rounded-2xl border border-line bg-panel px-4 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-medium">
                        {event.action} · {event.outcome}
                      </p>
                      <time className="text-xs text-muted" dateTime={event.at}>
                        {stamp(event.at)}
                      </time>
                    </div>
                    <p className="mt-1 text-sm leading-6 break-words text-muted">{event.detail}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-line bg-panel p-4 sm:p-5">
            <h2 className="font-display text-3xl">Việc cần chủ repo quyết</h2>
            <ul className="mt-3 flex flex-col gap-2 text-sm leading-6 text-muted">
              <li>Phase 2: chọn project Firebase, nếu có, và người giữ service account.</li>
              <li>Phase 3: 9Router có được gọi live không, và ngân sách model.</li>
              <li>Phase 4: browser thật vẫn phải nằm sau cổng duyệt.</li>
              <li>
                Phase 5: Zalo và eOffice dừng lại cho đến khi có quyết định riêng. Không tự chạy.
              </li>
            </ul>
          </section>
        </main>
      </div>
    </div>
  );
}
