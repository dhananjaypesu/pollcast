import { type Browser, expect, type Page, test } from "@playwright/test";

const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

async function openPhone(browser: Browser, code: string): Promise<Page> {
  const page = await (await browser.newContext(phone)).newPage();
  await page.goto(`/j/${code}`);
  return page;
}

test("a presenter runs a poll and Q&A while the audience follows live", async ({ page: host, browser }) => {
  // Presenter creates a session from the home page.
  await host.goto("/");
  await host.getByLabel("Session name").fill("DBMS lecture 7");
  await host.getByRole("button", { name: "Start a session" }).click();
  await expect(host).toHaveURL(/\/host\/[A-Z0-9]{6}$/);
  const code = host.url().split("/host/")[1];
  await expect(host.getByText(`Join code ${code.split("").join(" ")}`)).toBeAttached();

  // Two students join from their phones; the host sees them arrive.
  const alice = await openPhone(browser, code);
  const bob = await openPhone(browser, code);
  await expect(alice.getByText("Waiting for the next poll")).toBeVisible();
  await expect(host.getByText("2 people here")).toBeVisible();

  // Presenter creates and opens a poll.
  await host.getByPlaceholder("Which topic").fill("Which normal form is hardest?");
  await host.getByRole("textbox", { name: "Option 1" }).fill("3NF");
  await host.getByRole("textbox", { name: "Option 2" }).fill("BCNF");
  await host.getByRole("button", { name: "Create and open" }).click();
  await expect(host.getByText("Live now")).toBeVisible();

  // The poll appears on both phones without a reload; they vote.
  await alice.getByRole("button", { name: "BCNF", exact: true }).click();
  await expect(alice.getByText("Your vote", { exact: true })).toBeVisible();
  await bob.getByRole("button", { name: "BCNF", exact: true }).click();
  await expect(host.locator(".host__live .results__total")).toHaveText("2 votes");
  await expect(host.locator(".host__live .result").nth(1)).toContainText("100");

  // Alice's vote survives a reload.
  await alice.reload();
  await expect(alice.getByText("Your vote", { exact: true })).toBeVisible();

  // Closing the poll stops voting everywhere.
  await host.getByRole("button", { name: "Close voting" }).click();
  await expect(bob.getByText("Voting is closed.")).toBeVisible();

  // Q&A: Bob asks, Alice upvotes, the host marks it answered.
  await bob.getByRole("tab", { name: /Questions/ }).click();
  await bob.getByLabel("Your question").fill("Is BCNF always dependency preserving?");
  await bob.getByRole("button", { name: "Send question" }).click();
  await expect(bob.getByText("Question sent")).toBeVisible();

  await alice.getByRole("tab", { name: /Questions/ }).click();
  await alice.getByRole("button", { name: /^Upvote/ }).click();
  await expect(alice.getByRole("button", { name: /Remove upvote: 1 upvote/ })).toBeVisible();

  const hostQuestion = host.locator(".host__questions .question").first();
  await expect(hostQuestion).toContainText("Is BCNF always dependency preserving?");
  await expect(hostQuestion.locator(".question__vote-count")).toHaveText("1");
  await hostQuestion.getByRole("button", { name: "Mark answered" }).click();
  await expect(bob.getByText("Answered", { exact: true })).toBeVisible();

  // The projector view shows the closed results and the join code.
  const screen = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  await screen.goto(`/screen/${code}`);
  await expect(screen.getByText("Final results")).toBeVisible();
  await expect(screen.getByText("2 people joined")).toBeVisible();
});

test("joining with an unknown code explains what to do", async ({ browser }) => {
  const page = await (await browser.newContext(phone)).newPage();
  await page.goto("/");
  await page.getByLabel("Session code").fill("zzzzzz");
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page.getByRole("alert")).toHaveText(/No session uses the code ZZZZZZ/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
});

test("host controls are refused without the host token", async ({ page, request }) => {
  const res = await request.post("/api/sessions", { data: { title: "Private" } });
  const { code } = await res.json();
  await page.goto(`/host/${code}`);
  await expect(page.getByRole("heading", { name: "Can't open this session as the host" })).toBeVisible();
});
