// Copyright (C) 2026 SoftwareConvene LLC and the MealConvene contributors.
// Part of MealConvene, free software under the GNU AGPL-3.0-only; see LICENSE and NOTICE.txt.
//
// Subway (www.subway.com).
//
// ⚠ UNVERIFIED against the live customizer. Subway's site blocks automated
// browsers, so this was written from the menu pages a person can see, not
// from a recorded run. The first real order is the test: it stops at the
// first thing it can't do. Use "Save page map" in the panel on the sandwich
// customizer and send the file in, and this adapter gets exact selectors.
//
// What it knows so far:
// - Menu sections are links/tabs: "Sandwiches", "Wraps", ... (the template uses the same words).
// - The site calls the cart a "bag", so the confirm button says "Add to Bag".
// - Subway pre-ticks each sandwich's recipe toppings. The engine unticks any
//   the student didn't choose, using the full option list in the manifest.

(() => {
  const MC = window.__mealconvene;
  if (!MC || MC.adapters.some((a) => a.name === 'subway')) return;

  const synonyms = {
    'Size': ['Choose your size', 'Sandwich size'],
    '6 Inch': ['6"', '6 in', 'Six Inch', '6-Inch'],
    'Footlong': ['Footlong', '12"', '12 Inch'],
    'Bread': ['Choose your bread', 'Breads'],
    'Cheese': ['Choose your cheese', 'Cheeses'],
    'Toasting': ['Toasted?', 'Toast it', 'Toast'],
    'Toasted': ['Toast it', 'Yes, toast'],
    'Not Toasted': ['Not toasted', 'No toast', 'Don\'t toast'],
    'Veggies': ['Vegetables', 'Veggies', 'Choose your veggies'],
    'Sauces': ['Sauce', 'Sauces & Seasonings', 'Condiments'],
    'Seasonings': ['Seasoning', 'Sauces & Seasonings'],
    'Extras': ['Add-ons', 'Extras', 'Make it extra'],
    'Jalapeños': ['Jalapeno Peppers', 'Jalapeño Peppers'],
    'Black Olives': ['Olives', 'Black Olives'],
    'Pickles': ['Crinkle Pickles', 'Pickles'],
    'Spinach': ['Baby Spinach'],
    'Yellow Mustard': ['Mustard', 'Yellow Mustard'],
    'Black Pepper': ['Pepper'],
    'Sliced Avocado': ['Avocado'],
    'Double Protein': ['Double Meat', 'Double Protein'],
  };

  MC.register({
    name: 'subway',
    match: (loc) => /(^|\.)subway\.com$/.test(loc.hostname),
    async addLine(line, ctx = {}) {
      return MC.generic.addLine(line, {
        ...ctx,
        synonyms,
        categorySynonyms: { Sandwiches: ['Subs', 'Footlongs'], Sides: ['Snacks, Sides & Desserts', 'Sides'], Drinks: ['Drinks', 'Beverages'] },
        // Wraps share sandwich names; the category tab is what tells them apart.
        itemSynonyms: line.category === 'Wraps' ? [`${line.item} Wrap`] : [],
      });
    },
  });
})();
