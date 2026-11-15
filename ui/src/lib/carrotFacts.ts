// The bank of carrot facts the waiting screen rotates through, one quiet line
// at a time. The reader is waiting on an agent, so the bar for an entry is that
// it be true, checkable, and forgettable — a flourish, never a distraction.
//
// Every `source` was fetched and the claim located in the page text before the
// entry was written, and deep-links to the stating section where the article has
// one. carrotFacts.test.ts requires the source URLs to be distinct, which is
// per-URL and not per-page: several entries cite different sections of the same
// Carrot article. Entries are bounded by that same suite — no health claims, and
// nothing shaped like the wartime night-vision myth — and by subject: the carrot
// as a vegetable, never the wildflower, an idiom, or anything else named carrot.

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
    text: "Several compounds make a carrot taste bitter, and falcarindiol is a significant one: stored carrots hold it at nine times its bitter-taste threshold.",
    source: "https://pubmed.ncbi.nlm.nih.gov/12797757/",
  },
  {
    text: "Linnaeus gave the carrot's species its name, Daucus carota, in Species Plantarum in 1753.",
    source: "https://en.wikipedia.org/wiki/Carrot#Taxonomic_history",
  },
  {
    text: "The first cultivated carrots were grown for their aromatic leaves and seeds, not for the root.",
    source: "https://en.wikipedia.org/wiki/Carrot#History",
  },
  {
    text: "Most carrot cultivars mature within 70 to 80 days under the right conditions, and do best in deep, loose, well-drained soil.",
    source: "https://en.wikipedia.org/wiki/Carrot#Propagation",
  },
  {
    text: "Carrots split in the ground and break after harvest, and between them those two defects can affect over 30% of a commercial crop.",
    source: "https://en.wikipedia.org/wiki/Carrot#Pests_and_diseases",
  },
  {
    text: "Western carrots sort by root shape into four types — Chantenay, Danvers, Imperator and Nantes — and the Danvers type was developed in Danvers, Massachusetts, in 1871.",
    source: "https://en.wikipedia.org/wiki/Carrot#Cultivars",
  },
  {
    text: "Mature carrots, tops removed, can keep for 7 to 9 months at 0 °C and 98 to 100% humidity.",
    source: "https://www.ars.usda.gov/arsuserfiles/oc/np/commercialstorage/commercialstorage.pdf",
  },
  {
    text: "Carrots and turnips together came to 45 million tonnes of world production in 2024, 42% of it grown in China.",
    source: "https://en.wikipedia.org/wiki/Carrot#Production",
  },
  {
    text: "Under the EU's 2001 jam directive, carrots count as fruit — and so do tomatoes, rhubarb stalks, sweet potatoes, cucumbers, pumpkins and melons.",
    source: "https://www.legislation.gov.uk/eudr/2001/113/annex/III",
  },
  {
    text: "Carrots grown as a food crop are cultivars of Daucus carota subsp. sativus — the same species as the wild carrot, or Queen Anne's lace.",
    source: "https://en.wikipedia.org/wiki/Daucus_carota",
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
    text: "The carrot belongs to the Apiaceae, or Umbelliferae, a family that also holds parsley, celery, coriander, cumin, dill, fennel and parsnip.",
    source: "https://en.wikipedia.org/wiki/Apiaceae",
  },
  {
    text: "Holtville, California calls itself the Carrot Capital of the World and holds a Carrot Festival every winter.",
    source: "https://en.wikipedia.org/wiki/Holtville,_California",
  },
  {
    text: "A black carrot takes its colour from anthocyanins, the pigment class approved as food colouring in the EU, Australia and New Zealand under the code E163.",
    source: "https://en.wikipedia.org/wiki/Anthocyanin#Colorant_safety",
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
    text: "California grew 73% of the United States' carrots in 2025, a crop worth $2.02 billion nationwide.",
    source: "https://esmis.nal.usda.gov/sites/default/release-files/795772/vegean26.txt",
  },
  {
    text: "Carrots were domesticated in the Early Middle Ages, between the sixth and tenth centuries, in a region spanning western to central Asia.",
    source: "https://www.nature.com/articles/s41477-023-01526-6",
  },
  {
    text: "The first domesticated carrots were purple or yellow; the orange carrot was selected from yellow ones during the Renaissance, probably in the Netherlands or Belgium.",
    source: "https://pmc.ncbi.nlm.nih.gov/articles/PMC10581907/",
  },
  {
    text: "Purple carrots owe their colour to a gene called DcMYB7: knocked out with CRISPR, it turned the purple cultivar 'Deep Purple' yellow.",
    source: "https://pubmed.ncbi.nlm.nih.gov/31213511/",
  },
  {
    text: "A high-quality carrot genome, published in 2016 from an orange Nantes-type carrot, predicted 32,113 genes.",
    source: "https://www.nature.com/articles/ng.3565",
  },
  {
    text: "White carrot roots express the carotenoid-cleaving gene DcCCD4 significantly more than orange ones, and overexpressing it turns an orange carrot pale yellow.",
    source: "https://pubmed.ncbi.nlm.nih.gov/34547154/",
  },
  {
    text: "In UMass storage trials, carrots grew sweeter over their first few months in storage, peaking after 3 to 4 months before declining fast.",
    source:
      "https://www.umass.edu/agriculture-food-environment/vegetable/special-topics/winter-production-storage/storage/2010-2011-storage-carrot-trials",
  },
  {
    text: "Carrots should never be transplanted: a moved carrot's root forks as it develops.",
    source: "https://extension.sdstate.edu/how-grow-it-carrots",
  },
  {
    text: "Large mechanical carrot harvesters undercut the root, grasp the leaves and lift the roots out of the soil.",
    source: "https://extension.usu.edu/vegetableguide/root-crops/harvest-storage",
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
 * bag-randomizer seam, and at 29 facts it is a 1-in-29 chance every 24 minutes
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
