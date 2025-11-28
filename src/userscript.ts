import Idbkv from "idb-kv";

type HomefeedItem = {
  slug: string;
  product: { slug: string };
};

type CacheEntry = {
  savedAt: number;
  items: HomefeedItem[];
};

type GuessOption = {
  value: number;
  isCorrect: boolean;
};

const STORE_NAME = "product-hunt-guesser";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const GRAPHQL_URL = "https://www.producthunt.com/frontend/graphql";
const LEADERBOARD_HASH =
  "74a5405972fc0b6a8e704d6970968116d8fb6021db27d95bad59f376bbba12d4";
const OPTION_COUNT = 6;
const RANGE_DEFINITIONS = [
  { min: 0, max: 20 },
  { min: 21, max: 60 },
  { min: 61, max: 180 },
  { min: 181, max: 540 },
  { min: 541, max: 1620 },
  { min: 1621, max: 4860 },
  { min: 4861, max: 14580 },
];

const store = new Idbkv(STORE_NAME);

const numberFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 0,
});

function whenReady(cb: () => void | Promise<void>) {
  if (
    document.readyState === "complete" ||
    document.readyState === "interactive"
  ) {
    void cb();
    return;
  }

  window.addEventListener("DOMContentLoaded", () => void cb(), { once: true });
}

function isLaunchPage(url: string): boolean {
  return /^https:\/\/www\.producthunt\.com\/products\/[^/]+\/launches\/[^/]+/.test(
    url
  );
}

function parseLatestScoreFromButton(button: Element | null): number {
  if (!button?.textContent) return 0;

  const match = button.textContent.replace(/\u00a0/g, " ").match(/([\d.,]+)/);
  if (!match) return 0;

  const digits = match[1].replace(/[^\d]/g, "");
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function removeArchivedSection() {
  const archivedCard = document.querySelector<HTMLElement>(
    'section[data-test="post-archived-review-card"]'
  );
  let node: HTMLElement | null | undefined = archivedCard;
  while (node) {
    const next = node.nextElementSibling as HTMLElement | null;
    node.remove();
    node = next;
  }
}

function deriveOptions(latestScore: number): GuessOption[] {
  const baseCandidates = RANGE_DEFINITIONS.map((range) =>
    Math.floor((range.min + range.max) / 2)
  );
  const targetRangeIndex =
    RANGE_DEFINITIONS.findIndex(
      (range) => latestScore >= range.min && latestScore <= range.max
    ) ?? -1;
  const effectiveIndex =
    targetRangeIndex >= 0 ? targetRangeIndex : RANGE_DEFINITIONS.length - 1;

  baseCandidates[effectiveIndex] = latestScore;

  const uniqueCandidates = Array.from(new Set(baseCandidates));
  const removed: number[] = [];

  const spaced = enforceSpacing(uniqueCandidates, latestScore, removed);

  const trimmed = trimToSize(spaced, latestScore, OPTION_COUNT, removed);
  const padded = padOptions(trimmed, latestScore, OPTION_COUNT, removed);

  return padded
    .sort((a, b) => a - b)
    .map((value) => ({ value, isCorrect: value === latestScore }));
}

function enforceSpacing(
  values: number[],
  correctValue: number,
  removed: number[]
) {
  const sorted = [...values].sort((a, b) => a - b);
  const result: number[] = [];

  for (const value of sorted) {
    const last = result[result.length - 1];
    if (last === undefined || value >= last * 2) {
      result.push(value);
      continue;
    }

    const lastIsCorrect = last === correctValue;
    const currentIsCorrect = value === correctValue;

    if (currentIsCorrect && lastIsCorrect) {
      continue;
    }

    if (currentIsCorrect) {
      removed.push(last);
      result[result.length - 1] = value;
      continue;
    }

    if (lastIsCorrect) {
      removed.push(value);
      continue;
    }

    const dropCurrent =
      Math.abs(value - correctValue) >= Math.abs(last - correctValue);
    if (dropCurrent) {
      removed.push(value);
    } else {
      removed.push(last);
      result[result.length - 1] = value;
    }
  }

  return result;
}

function trimToSize(
  values: number[],
  correctValue: number,
  desired: number,
  removed: number[]
) {
  const list = [...values];
  while (list.length > desired) {
    const candidates = list.filter((value) => value !== correctValue);
    if (!candidates.length) break;

    const farthest = candidates.reduce(
      (current, value) => {
        if (current === null) return value;
        return Math.abs(value - correctValue) > Math.abs(current - correctValue)
          ? value
          : current;
      },
      null as number | null
    );

    if (farthest === null) break;

    const index = list.indexOf(farthest);
    if (index >= 0) {
      removed.push(farthest);
      list.splice(index, 1);
    } else {
      break;
    }
  }
  return list;
}

function padOptions(
  values: number[],
  correctValue: number,
  desired: number,
  removed: number[]
) {
  const list = [...values].sort((a, b) => a - b);
  const pending = [...removed].sort(
    (a, b) => Math.abs(a - correctValue) - Math.abs(b - correctValue)
  );

  for (const candidate of pending) {
    if (list.length >= desired) break;
    if (canInsertWithSpacing(list, candidate)) {
      list.push(candidate);
      list.sort((a, b) => a - b);
    }
  }

  const maxAllowed = Math.max(
    RANGE_DEFINITIONS[RANGE_DEFINITIONS.length - 1].max,
    correctValue
  );

  while (list.length < desired) {
    const smallest = list[0];
    const largest = list[list.length - 1];

    const newLow = Math.max(1, Math.floor(smallest / 2));
    if (canInsertWithSpacing(list, newLow)) {
      list.push(newLow);
      list.sort((a, b) => a - b);
      continue;
    }

    const proposedHigh = Math.min(
      maxAllowed,
      Math.max(largest * 2, largest + 1)
    );
    if (canInsertWithSpacing(list, proposedHigh)) {
      list.push(proposedHigh);
      list.sort((a, b) => a - b);
      continue;
    }

    break;
  }

  return list;
}

function canInsertWithSpacing(values: number[], candidate: number) {
  const withCandidate = [...values, candidate].sort((a, b) => a - b);
  for (let i = 1; i < withCandidate.length; i += 1) {
    if (withCandidate[i] < withCandidate[i - 1] * 2) return false;
  }
  return true;
}

function buildGuessUI(latestScore: number) {
  const options = deriveOptions(latestScore);
  const container = document.createElement("div");
  container.style.margin = "1rem 0";
  container.style.padding = "1rem";
  container.style.border = "1px solid rgba(0, 0, 0, 0.1)";
  container.style.borderRadius = "12px";
  container.style.background = "#fff";
  container.style.boxShadow = "0 10px 20px rgba(0,0,0,0.06)";
  container.style.maxWidth = "680px";
  container.style.fontFamily =
    "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

  const heading = document.createElement("div");
  heading.textContent = "Guess the launch score";
  heading.style.fontWeight = "700";
  heading.style.fontSize = "18px";
  heading.style.marginBottom = "12px";
  container.append(heading);

  const grid = document.createElement("div");
  grid.style.display = "grid";
  grid.style.gridTemplateColumns = "repeat(3, minmax(0, 1fr))";
  grid.style.gap = "10px";
  grid.style.alignItems = "stretch";

  const status = document.createElement("div");
  status.style.marginTop = "10px";
  status.style.minHeight = "22px";
  status.style.fontWeight = "600";

  let hasGuessed = false;
  let nextButton: HTMLButtonElement | null = null;

  const renderNextButton = () => {
    if (nextButton) return nextButton;
    nextButton = document.createElement("button");
    nextButton.textContent = "Next";
    nextButton.style.marginTop = "12px";
    nextButton.style.width = "100%";
    nextButton.style.padding = "12px";
    nextButton.style.background = "#0f766e";
    nextButton.style.color = "#fff";
    nextButton.style.border = "none";
    nextButton.style.borderRadius = "10px";
    nextButton.style.fontSize = "16px";
    nextButton.style.cursor = "pointer";
    nextButton.addEventListener(
      "click",
      () => void handleNextClick(nextButton!)
    );
    container.append(nextButton);
    return nextButton;
  };

  options.forEach((option) => {
    const button = document.createElement("button");
    button.textContent = numberFormatter.format(option.value);
    button.style.padding = "14px 10px";
    button.style.borderRadius = "10px";
    button.style.border = "1px solid rgba(0, 0, 0, 0.1)";
    button.style.background = "#f9fafb";
    button.style.fontWeight = "700";
    button.style.cursor = "pointer";
    button.style.transition = "transform 120ms ease, background 120ms ease";
    button.addEventListener("mouseenter", () => {
      if (hasGuessed) return;
      button.style.transform = "translateY(-1px)";
    });
    button.addEventListener("mouseleave", () => {
      button.style.transform = "translateY(0)";
    });

    button.addEventListener("click", () => {
      if (hasGuessed) return;
      hasGuessed = true;
      const wasCorrect = option.isCorrect;
      const optionButtons = Array.from(grid.querySelectorAll("button"));
      optionButtons.forEach((btn) => {
        const value = Number(btn.dataset.value);
        if (Number.isFinite(value) && value === latestScore) {
          btn.style.background = "#ecfdf3";
          btn.style.borderColor = "#22c55e";
          btn.style.color = "#065f46";
        }
        btn.setAttribute("disabled", "true");
        btn.style.cursor = "default";
      });

      if (!wasCorrect) {
        button.style.background = "#fef2f2";
        button.style.borderColor = "#f87171";
        button.style.color = "#991b1b";
      }

      status.textContent = wasCorrect
        ? "Correct!"
        : "Close one—try another launch.";
      status.style.color = wasCorrect ? "#065f46" : "#991b1b";

      renderNextButton();
    });

    button.dataset.value = String(option.value);
    grid.append(button);
  });

  container.append(grid);
  container.append(status);

  const host = document.querySelector("main") ?? document.body;
  host.prepend(container);
}

async function handleNextClick(button: HTMLButtonElement) {
  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = "Loading…";

  try {
    const { year, week, page } = pickRandomCoordinates();
    const items = await getLeaderboardPage(year, week, page);
    if (!items.length) throw new Error("No items returned");

    const randomItem = items[Math.floor(Math.random() * items.length)];
    const nextUrl = `https://www.producthunt.com/products/${randomItem.product.slug}/launches/${randomItem.slug}`;
    window.location.href = nextUrl;
  } catch (error) {
    console.error("[ProductHuntGuesser] Failed to load next launch", error);
    button.disabled = false;
    button.textContent = originalText;
    button.title = error instanceof Error ? error.message : String(error);
  }
}

function pickRandomCoordinates() {
  const currentYear = new Date().getFullYear();
  return {
    year: randomInt(2022, currentYear),
    week: randomInt(1, 52),
    page: randomInt(1, 10),
  };
}

async function getLeaderboardPage(year: number, week: number, page: number) {
  const cacheKey = `leaderboard:${year}:${week}:${page}`;
  const cached = (await store.get(cacheKey)) as CacheEntry | undefined;
  const now = Date.now();

  if (cached && now - cached.savedAt < CACHE_TTL_MS) {
    return cached.items;
  }

  const items = await fetchLeaderboardPage(year, week, page);
  const entry: CacheEntry = { savedAt: now, items };
  await store.set(cacheKey, entry);
  return items;
}

async function fetchLeaderboardPage(year: number, week: number, page: number) {
  const targetPage = Math.max(1, Math.min(page, 10));
  let cursor = "";
  let currentPage = 1;
  let lastItems: HomefeedItem[] = [];

  while (currentPage <= targetPage) {
    const variables = {
      featured: false,
      year,
      week,
      order: "VOTES",
      cursor,
    };

    const params = new URLSearchParams({
      operationName: "LeaderboardWeeklyPage",
      variables: JSON.stringify(variables),
      extensions: JSON.stringify({
        persistedQuery: { version: 1, sha256Hash: LEADERBOARD_HASH },
      }),
    });

    const response = await fetch(`${GRAPHQL_URL}?${params.toString()}`, {
      method: "GET",
      credentials: "include",
      headers: { accept: "*/*" },
    });

    if (!response.ok) {
      throw new Error(`Leaderboard request failed with ${response.status}`);
    }

    const payload = (await response.json()) as {
      data?: {
        homefeedItems?: {
          edges?: Array<{ node?: HomefeedItem | null }>;
          pageInfo?: { endCursor?: string | null };
        };
      };
    };

    const edges = payload.data?.homefeedItems?.edges ?? [];
    const pageItems = edges
      .map((edge) => edge?.node)
      .filter((node): node is HomefeedItem =>
        Boolean(node?.slug && node?.product?.slug)
      );

    if (currentPage === targetPage) {
      lastItems = pageItems;
      break;
    }

    const nextCursor = payload.data?.homefeedItems?.pageInfo?.endCursor;
    if (!nextCursor) {
      lastItems = pageItems;
      break;
    }

    cursor = nextCursor;
    currentPage += 1;
  }

  return lastItems;
}

function randomInt(min: number, max: number) {
  const minInt = Math.ceil(min);
  const maxInt = Math.floor(max);
  return Math.floor(Math.random() * (maxInt - minInt + 1)) + minInt;
}

function preparePage() {
  const voteButton = document.querySelector('button[data-test="vote-button"]');
  const latestScore = parseLatestScoreFromButton(voteButton);
  voteButton?.remove();

  removeArchivedSection();
  buildGuessUI(latestScore);
}

function main() {
  if (!isLaunchPage(window.location.href)) return;
  whenReady(preparePage);
}

main();
