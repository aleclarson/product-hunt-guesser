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

async function waitForElement(
  selector: string,
  timeoutMs = 10000
): Promise<Element | null> {
  const existing = document.querySelector(selector);
  if (existing) return existing;

  return new Promise((resolve) => {
    let done = false;
    let observer: MutationObserver | null = null;

    const timeout = window.setTimeout(() => {
      if (done) return;
      done = true;
      observer?.disconnect();
      resolve(null);
    }, timeoutMs);

    observer = new MutationObserver(() => {
      if (done) return;
      const found = document.querySelector(selector);
      if (!found) return;
      done = true;
      window.clearTimeout(timeout);
      observer?.disconnect();
      resolve(found);
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  });
}

function isLaunchPage(url: string): boolean {
  return /producthunt\.com\/products\/[^/]+\/launches\/[^/]+/.test(url);
}

function removeNodesFromHere(node: Element | null) {
  while (node) {
    const next = node.nextElementSibling as Element | null;
    node.remove();
    node = next;
  }
}

function deriveOptions(latestScore: number): GuessOption[] {
  const targetRangeIndex = RANGE_DEFINITIONS.findIndex(
    (range) => latestScore >= range.min && latestScore <= range.max
  );
  const effectiveIndex =
    targetRangeIndex >= 0 ? targetRangeIndex : RANGE_DEFINITIONS.length - 1;

  const dropFirstDistance = Math.abs(effectiveIndex - 0);
  const dropLastDistance = Math.abs(
    effectiveIndex - (RANGE_DEFINITIONS.length - 1)
  );
  const dropIndex =
    dropFirstDistance > dropLastDistance ? 0 : RANGE_DEFINITIONS.length - 1;

  const selectedRangeIndexes = RANGE_DEFINITIONS.map((_, idx) => idx).filter(
    (idx) => idx !== dropIndex
  );

  type OptionCandidate = {
    value: number;
    isCorrect: boolean;
    rangeIndex: number;
  };

  const buildOption = (rangeIndex: number): OptionCandidate => {
    const range = RANGE_DEFINITIONS[rangeIndex];
    const inRange =
      latestScore >= range.min &&
      (rangeIndex === RANGE_DEFINITIONS.length - 1
        ? latestScore >= range.min
        : latestScore <= range.max);

    if (inRange) {
      return { value: latestScore, isCorrect: true, rangeIndex };
    }

    return {
      value: rollRangeValue(rangeIndex, latestScore),
      isCorrect: false,
      rangeIndex,
    };
  };

  const options: OptionCandidate[] = selectedRangeIndexes.map((idx) =>
    buildOption(idx)
  );

  let guard = 0;
  while (true) {
    options.sort((a, b) => a.value - b.value);
    let violationIndex = -1;
    for (let i = 1; i < options.length; i += 1) {
      if (options[i].value < options[i - 1].value * 2) {
        violationIndex = i;
        break;
      }
    }

    if (violationIndex === -1) break;

    const higher = options[violationIndex];
    const lower = options[violationIndex - 1];

    if (!higher.isCorrect) {
      higher.value = rollRangeValue(higher.rangeIndex, latestScore);
    } else if (!lower.isCorrect) {
      lower.value = rollRangeValue(lower.rangeIndex, latestScore);
    } else {
      higher.value = rollRangeValue(higher.rangeIndex, latestScore);
    }

    guard += 1;
    if (guard > 500) {
      console.warn(
        "[ProductHuntGuesser] Unable to space options after many attempts."
      );
      break;
    }
  }

  return options
    .sort((a, b) => a.value - b.value)
    .map((option) => ({
      value: option.value,
      isCorrect: option.isCorrect,
    }));
}

function rollRangeValue(rangeIndex: number, latestScore: number) {
  const range = RANGE_DEFINITIONS[rangeIndex];
  let candidate = randomInt(range.min, range.max);
  let guard = 0;
  while (candidate === latestScore && guard < 20) {
    candidate = randomInt(range.min, range.max);
    guard += 1;
  }
  return candidate;
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

  return container;
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

async function preparePage() {
  const archivedSection = await waitForElement(
    'section[data-test="post-archived-review-card"]',
    15000
  );
  if (!archivedSection) {
    console.warn(
      "[ProductHuntGuesser] Timed out waiting for archived review card."
    );
    return;
  }

  const voteButton = document.querySelector('button[data-test="vote-button"]');
  if (!voteButton) {
    console.warn("[ProductHuntGuesser] Unable to find vote button.");
    return;
  }

  const latestScore = +voteButton.textContent.replace(/\D/g, "");
  if (Number.isNaN(latestScore)) {
    console.warn("[ProductHuntGuesser] Unable to parse latest score.");
    return;
  }

  const guessUI = buildGuessUI(latestScore);
  archivedSection.before(guessUI);

  voteButton.remove();
  removeNodesFromHere(archivedSection);
}

function main() {
  if (!isLaunchPage(window.location.href)) return;
  whenReady(preparePage);
}

main();
