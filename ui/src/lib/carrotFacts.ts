// The bank of carrot facts the waiting screen rotates through, one quiet line
// at a time. The reader is waiting on an agent, so the bar for an entry is that
// it be true, checkable, and forgettable — a flourish, never a distraction.
//
// Every `source` was fetched and the claim located in the page text before the
// entry was written, and deep-links to the stating section where the article has
// one. carrotFacts.test.ts requires the source URLs to be distinct, which is
// per-URL and not per-page: eleven entries cite different sections of the same
// Carrot article. Entries are bounded by that same suite — no health claims, and
// nothing shaped like the wartime night-vision myth.

export interface CarrotFact {
  /** One verifiable sentence. No health claims, no violent framing. */
  readonly text: string;
  /** A reputable third-party page where the claim is stated. */
  readonly source: string;
}

export const CARROT_FACTS: readonly CarrotFact[] = [
  {
    text: "The word carrot reached English around 1530 by way of the Middle French carotte, and traces back through Greek to a root meaning horn — for the shape.",
    source: "https://en.wikipedia.org/wiki/Carrot#Etymology",
  },
  {
    text: "A carrot is a biennial: it spends its first year banking energy in the taproot, and only flowers in its second.",
    source: "https://en.wikipedia.org/wiki/Carrot#Description",
  },
  {
    text: "Whether a carrot tastes bitter comes down mostly to a single compound, falcarindiol.",
    source: "https://en.wikipedia.org/wiki/Carrot#Chemistry",
  },
  {
    text: "Linnaeus described the wild carrot as Daucus carota in Species Plantarum in 1753.",
    source: "https://en.wikipedia.org/wiki/Carrot#Taxonomic_history",
  },
  {
    text: "The first cultivated carrots were grown for their aromatic leaves and seeds, not for the root.",
    source: "https://en.wikipedia.org/wiki/Carrot#History",
  },
  {
    text: "Most carrot cultivars mature within 70 to 80 days, and do best in deep, loose, well-drained soil.",
    source: "https://en.wikipedia.org/wiki/Carrot#Propagation",
  },
  {
    text: "Splitting in the ground and breaking after harvest can between them affect over 30% of a commercial carrot crop.",
    source: "https://en.wikipedia.org/wiki/Carrot#Pests_and_diseases",
  },
  {
    text: "Western carrots sort by root shape into four types — Chantenay, Danvers, Imperator and Nantes — the Danvers named for the Massachusetts town that bred it in 1871.",
    source: "https://en.wikipedia.org/wiki/Carrot#Cultivars",
  },
  {
    text: "Carrots keep best just above freezing: 0 to 4 °C, at 90 to 95% humidity.",
    source: "https://en.wikipedia.org/wiki/Carrot#Storage",
  },
  {
    text: "World production of carrots and turnips reached 45 million tonnes in 2024, and China grew 42% of it.",
    source: "https://en.wikipedia.org/wiki/Carrot#Production",
  },
  {
    text: "So that Portugal could keep selling its carrot jam, the Council of the European Union classified the carrot as a fruit for the purposes of jam regulation.",
    source: "https://en.wikipedia.org/wiki/Carrot#Culinary",
  },
  {
    text: "Every cultivated carrot is a cultivar of Daucus carota subsp. sativus — the same species as the roadside wild carrot, or Queen Anne's lace.",
    source: "https://en.wikipedia.org/wiki/Daucus_carota",
  },
  {
    text: "A wild carrot's flower head may carry a single pink or purple floret at its centre, known as the ruby.",
    source: "https://en.wikipedia.org/wiki/Daucus_carota#Description",
  },
  {
    text: "The wild carrot makes a useful companion plant, and Iowa, Michigan and Washington all list it as a noxious weed.",
    source: "https://en.wikipedia.org/wiki/Daucus_carota#Association_with_other_plants",
  },
  {
    text: "The name Queen Anne's lace is not recorded before 1895 — some 180 years after the queen it honours.",
    source: "https://en.wikipedia.org/wiki/Daucus_carota#Culture",
  },
  {
    text: "Baby-cut carrots were a 1986 waste-saving idea from the California farmer Mike Yurosek, who cut misshapen carrots down to a size that would sell.",
    source: "https://en.wikipedia.org/wiki/Baby_carrot#Baby-cut_carrots",
  },
  {
    text: "A baby-cut carrot begins as a full-grown one, cut into two-inch sections and then abraded down to its rounded shape.",
    source: "https://en.wikipedia.org/wiki/Baby_carrot#Production",
  },
  {
    text: "Carrot cake came back into fashion in Britain under wartime rationing, helped along by a government campaign for the vegetable.",
    source: "https://en.wikipedia.org/wiki/Carrot_cake#History",
  },
  {
    text: "The carrot's family is also called Umbelliferae, after the umbel its flowers form; parsley, celery, coriander, cumin, dill, fennel and parsnip are all in it.",
    source: "https://en.wikipedia.org/wiki/Apiaceae",
  },
  {
    text: "Carrot and stick traces to a mid-19th-century cartoon of a donkey race, whose winner sat back and dangled a carrot from the end of his stick.",
    source: "https://en.wikipedia.org/wiki/Carrot_and_stick",
  },
  {
    text: "Holtville, California calls itself the Carrot Capital of the World and throws a ten-day Carrot Festival every winter.",
    source: "https://en.wikipedia.org/wiki/Holtville,_California",
  },
  {
    text: "Anthocyanins — the pigments behind a purple carrot — are approved as food colouring in the EU, Australia and New Zealand under the code E163.",
    source: "https://en.wikipedia.org/wiki/Anthocyanin#Colorant_safety",
  },
  {
    text: "Oil distilled from carrot seed is used in perfumery and to aromatise food.",
    source: "https://en.wikipedia.org/wiki/Carrot_seed_oil",
  },
  {
    text: "The heaviest carrot on record weighed 10.17 kg, grown by Christopher Qualley in Otsego, Minnesota in 2017.",
    source: "https://www.guinnessworldrecords.com/world-records/heaviest-carrot",
  },
  {
    text: "The longest carrot on record measured 6.245 m, grown by Joe Atherton and shown at Malvern in 2016.",
    source: "https://www.guinnessworldrecords.com/world-records/longest-carrot",
  },
  {
    text: "California grows over 85% of the carrots in the United States.",
    source: "https://www.agmrc.org/commodities-products/vegetables/carrots",
  },
];

/** How long one fact holds the line before the next is drawn. */
export const ROTATE_MS = 50_000;

/**
 * Draw facts from a shuffled bag rather than picking one at random each time.
 * An independent pick repeats itself over a long wait, and a line that repeats
 * is the one thing a reader parked on this screen would actually notice.
 *
 * No fact reappears until every other has been shown, save possibly across a
 * refill: a fresh bag may open on the one that just left. That is the standard
 * bag-randomizer seam, and at 26 facts it is a 1-in-26 chance every 22 minutes
 * of continuous waiting — left open rather than closed with last-drawn tracking,
 * which is more machinery than the odds buy.
 *
 * @param facts - The bank to draw from.
 * @param random - Source of randomness; injected so tests are deterministic.
 */
export function createFactBag(
  facts: readonly CarrotFact[] = CARROT_FACTS,
  random: () => number = Math.random,
): { next: () => CarrotFact } {
  let bag: CarrotFact[] = [];
  return {
    next() {
      if (bag.length === 0) bag = shuffle(facts, random);
      // `as`, not `!`: biome's noNonNullAssertion forbids the latter in ui/src.
      // The bank is non-empty (carrotFacts.test.ts holds a floor of 20), so the
      // pop always finds one.
      return bag.pop() as CarrotFact;
    },
  };
}

/** Fisher–Yates over a copy, so the caller's bank is never reordered. */
function shuffle(facts: readonly CarrotFact[], random: () => number): CarrotFact[] {
  const out = [...facts];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as CarrotFact, out[i] as CarrotFact];
  }
  return out;
}
