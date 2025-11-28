Your goal is to write a single-file script that runs via Tampermonkey. You can use TypeScript and I will compile it before running. The script will be run in the context of the Product Hunt website, so you can use the DOM API to interact with the page.

### Prepare The Page

When the current page's URL matches `https://www.producthunt.com/products/[product.slug]/launches/[slug]`, do the following:

  - Wait for the page to finish loading.
  - Remove the vote button at `button[data-test="vote-button"]`. Before doing so, derive the `latestScore` number from its `textContent`, which should be a localized string like "Upvote 1,234".
  - Remove the element at `section[data-test="post-archived-review-card"]` and any siblings after it.
  - Based on the item's `latestScore`, generate 6 options with one each in these ranges: 0-20, 21-60, 61-180, 181-540, 541-1620, 1621-4860, 4861-14580. Importantly, the item's `latestScore` replaces the option in its range (if greater than 14580, replace the last option). To keep them distinct, make sure each option is at least 2x difference from the next lowest option.
  - Display the options as a grid of 3x2. The user will guess the item's `latestScore` from the options. If they guess wrong, color the clicked option red. Always color the correct option green after they choose an option.
  - Once a guess is made, render a "Next" button immediately below the options.

### The "Next" Button

When the "Next" button is clicked, the following steps are taken:

- **1. Determine year, week, and page**
  - Randomly calculate a year (between 2022 and the current year), a week (between 1 and 52), and a page (between 1 and 10).
- **2. Check the cache**
  - We cache the leaderboard data for 24 hours. Create a cache key based on the year, week, and page. Use the `idb-kv` library to handle caching (see the `idb-kv.md` file for more details).
  - If the cache key exists and is less than 24 hours old, use the cached page data.
- **3. Fetch the page data**
  - If the page data is not cached, fetch it from the API.
  - See the `examples/weeklyLeaderboard/fetch.js` file for a general idea. Of course, you won't need to set *all* the headers, since a lot of it is handled by the browser. Just know that the `fetch.js` call works in the environment where your code will run.
  - Extract the needed data from the raw page data, caching it with `idb-kv` afterwards. See the `examples/weeklyLeaderboard/response.json` file for a general idea of the data structure.
    - We're interested in the `homefeedItems[].edges[].node` objects.
    - We just need the `slug` and `product.slug` fields for each item.
- **4. Choose a random item from the page data**
  - Randomly choose one of the items from the cached page data.
  - Navigate to the chosen item's URL, which is `https://www.producthunt.com/products/[product.slug]/launches/[slug]`.
