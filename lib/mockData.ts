/**
 * Mock dataset that mirrors the shape of Delever API V2 responses.
 * Used when USE_MOCKS=true (the default). Three Tashkent restaurants,
 * multilingual menus, modifiers and one item per restaurant pre-set in
 * the stop list so we can exercise the "out of stock" path.
 *
 * Reference: https://delever.gitbook.io/delever/for-developers/dlya-integratorov-v2
 */

export type LangCode = "ru" | "en" | "uz";
export type Localized = Record<LangCode, string>;

export interface MockRestaurant {
  id: string;
  name: Localized;
  address: Localized;
  location: { lat: number; long: number };
}

export interface MockRestaurantAvailability {
  id: string;
  enabled: boolean;
}

export interface MockModifierOption {
  id: string;
  name: Localized;
  price: number;
}

export interface MockModifier {
  id: string;
  name: Localized;
  min: number;
  max: number;
  options: MockModifierOption[];
}

export interface MockMenuItem {
  id: string;
  categoryId: string;
  name: Localized;
  description: Localized;
  price: number;
  weight: number;
  modifiers: MockModifier[];
}

export interface MockMenuCategory {
  id: string;
  parentId: string | null;
  name: Localized;
}

export interface MockMenuComposition {
  restaurantId: string;
  categories: MockMenuCategory[];
  items: MockMenuItem[];
  lastChange: string;
}

export interface MockStockEntry {
  id: string;
  stock: number;
}

export interface MockMenuAvailability {
  items: MockStockEntry[];
  modifiers: MockStockEntry[];
}

const sumPrefix = (n: number) => `${n.toLocaleString("ru-RU")} so'm`;
export { sumPrefix };

const sizeModifier: MockModifier = {
  id: "mod_size",
  name: { ru: "Размер", en: "Size", uz: "Hajmi" },
  min: 1,
  max: 1,
  options: [
    {
      id: "mod_size_regular",
      name: { ru: "Обычный", en: "Regular", uz: "Oddiy" },
      price: 0,
    },
    {
      id: "mod_size_large",
      name: { ru: "Большой", en: "Large", uz: "Katta" },
      price: 15000,
    },
  ],
};

const drinkAddons: MockModifier = {
  id: "mod_drink_addons",
  name: { ru: "Добавки", en: "Add-ons", uz: "Qo'shimchalar" },
  min: 0,
  max: 3,
  options: [
    {
      id: "mod_addon_extra_shot",
      name: { ru: "Доп. шот эспрессо", en: "Extra espresso shot", uz: "Qo'shimcha espresso" },
      price: 8000,
    },
    {
      id: "mod_addon_oat_milk",
      name: { ru: "Овсяное молоко", en: "Oat milk", uz: "Suli suti" },
      price: 5000,
    },
    {
      id: "mod_addon_syrup",
      name: { ru: "Сироп", en: "Syrup", uz: "Sirop" },
      price: 4000,
    },
  ],
};

const meatChoice: MockModifier = {
  id: "mod_meat",
  name: { ru: "Мясо", en: "Meat", uz: "Go'sht" },
  min: 1,
  max: 1,
  options: [
    {
      id: "mod_meat_lamb",
      name: { ru: "Баранина", en: "Lamb", uz: "Qo'y go'shti" },
      price: 0,
    },
    {
      id: "mod_meat_beef",
      name: { ru: "Говядина", en: "Beef", uz: "Mol go'shti" },
      price: 0,
    },
    {
      id: "mod_meat_chicken",
      name: { ru: "Курица", en: "Chicken", uz: "Tovuq" },
      price: -10000,
    },
  ],
};

export const MOCK_RESTAURANTS: MockRestaurant[] = [
  {
    id: "rst_plov_center",
    name: {
      ru: "Плов Центр",
      en: "Plov Center",
      uz: "Plov Markazi",
    },
    address: {
      ru: "ул. Бабура, 12, Ташкент",
      en: "Babur St 12, Tashkent",
      uz: "Bobur ko'chasi 12, Toshkent",
    },
    location: { lat: 41.301081, long: 69.240562 },
  },
  {
    id: "rst_tashkent_grill",
    name: {
      ru: "Ташкент Гриль",
      en: "Tashkent Grill",
      uz: "Toshkent Grill",
    },
    address: {
      ru: "пр. Амира Темура, 45, Ташкент",
      en: "Amir Temur Ave 45, Tashkent",
      uz: "Amir Temur shoh ko'chasi 45, Toshkent",
    },
    location: { lat: 41.326115, long: 69.281122 },
  },
  {
    id: "rst_black_bean",
    name: {
      ru: "Black Bean Coffee",
      en: "Black Bean Coffee",
      uz: "Black Bean Coffee",
    },
    address: {
      ru: "ул. Шота Руставели, 3, Ташкент",
      en: "Shota Rustaveli St 3, Tashkent",
      uz: "Shota Rustaveli ko'chasi 3, Toshkent",
    },
    location: { lat: 41.299731, long: 69.265321 },
  },
];

export const MOCK_RESTAURANT_AVAILABILITY: MockRestaurantAvailability[] = [
  { id: "rst_plov_center", enabled: true },
  { id: "rst_tashkent_grill", enabled: true },
  { id: "rst_black_bean", enabled: true },
];

const NOW_ISO = "2026-04-27T08:00:00.000Z";

const plovCenterMenu: MockMenuComposition = {
  restaurantId: "rst_plov_center",
  lastChange: NOW_ISO,
  categories: [
    { id: "cat_plov", parentId: null, name: { ru: "Плов", en: "Plov", uz: "Osh" } },
    { id: "cat_salads", parentId: null, name: { ru: "Салаты", en: "Salads", uz: "Salatlar" } },
    { id: "cat_drinks", parentId: null, name: { ru: "Напитки", en: "Drinks", uz: "Ichimliklar" } },
  ],
  items: [
    {
      id: "dish_plov_classic",
      categoryId: "cat_plov",
      name: { ru: "Классический плов", en: "Classic plov", uz: "Klassik osh" },
      description: {
        ru: "Узбекский плов с бараниной, морковью и зирой",
        en: "Uzbek plov with lamb, carrots and cumin",
        uz: "Qo'y go'shti, sabzi va zira bilan o'zbek oshi",
      },
      price: 45000,
      weight: 350,
      modifiers: [sizeModifier, meatChoice],
    },
    {
      id: "dish_plov_devzira",
      categoryId: "cat_plov",
      name: { ru: "Плов из девзиры", en: "Devzira plov", uz: "Devzira oshi" },
      description: {
        ru: "Из элитного сорта риса девзира с двойной порцией мяса",
        en: "Made with premium devzira rice, double meat portion",
        uz: "Premium devzira guruchidan, ikki barobar go'sht bilan",
      },
      price: 65000,
      weight: 400,
      modifiers: [sizeModifier],
    },
    {
      id: "dish_plov_vegetarian",
      categoryId: "cat_plov",
      name: { ru: "Вегетарианский плов", en: "Vegetarian plov", uz: "Vegetarian osh" },
      description: {
        ru: "С нутом, изюмом и сухофруктами вместо мяса",
        en: "With chickpeas, raisins and dried fruits instead of meat",
        uz: "Go'sht o'rniga no'xat, mayiz va quritilgan mevalar bilan",
      },
      price: 38000,
      weight: 320,
      modifiers: [sizeModifier],
    },
    {
      id: "dish_achichuk",
      categoryId: "cat_salads",
      name: { ru: "Ачичук", en: "Achichuk salad", uz: "Achichuq" },
      description: {
        ru: "Помидоры, лук, перец чили",
        en: "Tomatoes, onions, chili pepper",
        uz: "Pomidor, piyoz, achchiq qalampir",
      },
      price: 18000,
      weight: 180,
      modifiers: [],
    },
    {
      id: "dish_carrot_salad",
      categoryId: "cat_salads",
      name: { ru: "Морковь по-корейски", en: "Korean carrot", uz: "Koreyscha sabzi" },
      description: {
        ru: "Острая маринованная морковь",
        en: "Spicy marinated carrot",
        uz: "Achchiq marinad qilingan sabzi" ,
      },
      price: 14000,
      weight: 150,
      modifiers: [],
    },
    {
      id: "dish_green_tea",
      categoryId: "cat_drinks",
      name: { ru: "Зелёный чай", en: "Green tea", uz: "Ko'k choy" },
      description: {
        ru: "Чайник зелёного чая",
        en: "Pot of green tea",
        uz: "Ko'k choyli choynak",
      },
      price: 12000,
      weight: 500,
      modifiers: [],
    },
    {
      id: "dish_ayran",
      categoryId: "cat_drinks",
      name: { ru: "Айран", en: "Ayran", uz: "Ayron" },
      description: {
        ru: "Кисломолочный напиток",
        en: "Fermented milk drink",
        uz: "Achitilgan sut ichimligi",
      },
      price: 9000,
      weight: 300,
      modifiers: [],
    },
    {
      id: "dish_compote",
      categoryId: "cat_drinks",
      name: { ru: "Компот", en: "Compote", uz: "Kompot" },
      description: {
        ru: "Из сухофруктов",
        en: "Made from dried fruits",
        uz: "Quritilgan mevalardan",
      },
      price: 11000,
      weight: 350,
      modifiers: [],
    },
  ],
};

const tashkentGrillMenu: MockMenuComposition = {
  restaurantId: "rst_tashkent_grill",
  lastChange: NOW_ISO,
  categories: [
    { id: "cat_kebab", parentId: null, name: { ru: "Шашлык", en: "Kebab", uz: "Shashlik" } },
    { id: "cat_bread", parentId: null, name: { ru: "Хлеб", en: "Bread", uz: "Non" } },
    { id: "cat_drinks2", parentId: null, name: { ru: "Напитки", en: "Drinks", uz: "Ichimliklar" } },
  ],
  items: [
    {
      id: "dish_kebab_lamb",
      categoryId: "cat_kebab",
      name: { ru: "Шашлык из баранины", en: "Lamb kebab", uz: "Qo'y go'shtidan shashlik" },
      description: {
        ru: "Шашлык из вырезки на берёзовом угле, 2 шампура",
        en: "Lamb tenderloin kebab over birch coals, 2 skewers",
        uz: "Qayrag'ochda pishirilgan qo'y go'shtidan shashlik, 2 sixcha",
      },
      price: 55000,
      weight: 280,
      modifiers: [meatChoice],
    },
    {
      id: "dish_kebab_chicken",
      categoryId: "cat_kebab",
      name: { ru: "Шашлык из курицы", en: "Chicken kebab", uz: "Tovuqdan shashlik" },
      description: {
        ru: "Шашлык из куриного филе с овощами",
        en: "Chicken fillet kebab with vegetables",
        uz: "Sabzavotlar bilan tovuq filesidan shashlik",
      },
      price: 42000,
      weight: 250,
      modifiers: [],
    },
    {
      id: "dish_kebab_kofte",
      categoryId: "cat_kebab",
      name: { ru: "Кофта", en: "Kofta", uz: "Kebab" },
      description: {
        ru: "Рубленая баранина со специями",
        en: "Minced lamb with spices",
        uz: "Ziravorli mayda qo'y go'shti",
      },
      price: 48000,
      weight: 260,
      modifiers: [],
    },
    {
      id: "dish_kebab_liver",
      categoryId: "cat_kebab",
      name: { ru: "Шашлык из печени", en: "Liver kebab", uz: "Jigardan shashlik" },
      description: {
        ru: "Шашлык из бараньей печени с курдюком",
        en: "Lamb liver kebab with tail fat",
        uz: "Dumba bilan qo'y jigaridan shashlik",
      },
      price: 38000,
      weight: 220,
      modifiers: [],
    },
    {
      id: "dish_lavash",
      categoryId: "cat_bread",
      name: { ru: "Лаваш", en: "Lavash", uz: "Lavash" },
      description: {
        ru: "Тонкий лаваш ручной работы",
        en: "Hand-made thin lavash",
        uz: "Qo'lda yopilgan ingichka lavash",
      },
      price: 5000,
      weight: 80,
      modifiers: [],
    },
    {
      id: "dish_obi_non",
      categoryId: "cat_bread",
      name: { ru: "Узбекская лепёшка", en: "Obi non", uz: "Obi non" },
      description: {
        ru: "Свежая лепёшка из тандыра",
        en: "Fresh tandoor flatbread",
        uz: "Tandirdan yangi obi non",
      },
      price: 7000,
      weight: 250,
      modifiers: [],
    },
    {
      id: "dish_lemonade_mint",
      categoryId: "cat_drinks2",
      name: { ru: "Мятный лимонад", en: "Mint lemonade", uz: "Yalpizli limonad" },
      description: {
        ru: "Свежий лимонад с мятой и базиликом",
        en: "Fresh lemonade with mint and basil",
        uz: "Yalpiz va rayhon bilan limonad",
      },
      price: 22000,
      weight: 500,
      modifiers: [sizeModifier],
    },
    {
      id: "dish_kvass",
      categoryId: "cat_drinks2",
      name: { ru: "Квас", en: "Kvass", uz: "Kvas" },
      description: {
        ru: "Домашний квас",
        en: "Homemade kvass",
        uz: "Uy sharoitida tayyorlangan kvas",
      },
      price: 12000,
      weight: 400,
      modifiers: [],
    },
    {
      id: "dish_sparkling_water",
      categoryId: "cat_drinks2",
      name: { ru: "Минеральная вода", en: "Sparkling water", uz: "Mineral suv" },
      description: {
        ru: "Газированная минеральная вода",
        en: "Sparkling mineral water",
        uz: "Gazli mineral suv",
      },
      price: 9000,
      weight: 500,
      modifiers: [],
    },
  ],
};

const blackBeanMenu: MockMenuComposition = {
  restaurantId: "rst_black_bean",
  lastChange: NOW_ISO,
  categories: [
    { id: "cat_coffee", parentId: null, name: { ru: "Кофе", en: "Coffee", uz: "Kofe" } },
    { id: "cat_pastries", parentId: null, name: { ru: "Выпечка", en: "Pastries", uz: "Shirinliklar" } },
    { id: "cat_breakfast", parentId: null, name: { ru: "Завтраки", en: "Breakfast", uz: "Nonushta" } },
  ],
  items: [
    {
      id: "dish_espresso",
      categoryId: "cat_coffee",
      name: { ru: "Эспрессо", en: "Espresso", uz: "Espresso" },
      description: {
        ru: "Двойной эспрессо из зёрен Эфиопии",
        en: "Double espresso from Ethiopian beans",
        uz: "Efiopiya donlaridan ikki marta espresso",
      },
      price: 18000,
      weight: 60,
      modifiers: [drinkAddons],
    },
    {
      id: "dish_cappuccino",
      categoryId: "cat_coffee",
      name: { ru: "Капучино", en: "Cappuccino", uz: "Kappuchino" },
      description: {
        ru: "Капучино на цельном молоке",
        en: "Cappuccino on whole milk",
        uz: "To'liq sutda kappuchino",
      },
      price: 28000,
      weight: 250,
      modifiers: [sizeModifier, drinkAddons],
    },
    {
      id: "dish_latte",
      categoryId: "cat_coffee",
      name: { ru: "Латте", en: "Latte", uz: "Latte" },
      description: {
        ru: "Мягкий латте с молочной пенкой",
        en: "Soft latte with milk foam",
        uz: "Sutli ko'pikli yumshoq latte",
      },
      price: 30000,
      weight: 350,
      modifiers: [sizeModifier, drinkAddons],
    },
    {
      id: "dish_filter",
      categoryId: "cat_coffee",
      name: { ru: "Фильтр-кофе", en: "Filter coffee", uz: "Filtrli kofe" },
      description: {
        ru: "Фильтр-кофе на чемексе",
        en: "Filter coffee brewed on Chemex",
        uz: "Chemex'da pishirilgan filtrli kofe",
      },
      price: 32000,
      weight: 300,
      modifiers: [],
    },
    {
      id: "dish_croissant",
      categoryId: "cat_pastries",
      name: { ru: "Круассан", en: "Croissant", uz: "Kruassan" },
      description: {
        ru: "Классический сливочный круассан",
        en: "Classic butter croissant",
        uz: "Klassik sariyog'li kruassan",
      },
      price: 22000,
      weight: 90,
      modifiers: [],
    },
    {
      id: "dish_cheesecake",
      categoryId: "cat_pastries",
      name: { ru: "Чизкейк", en: "Cheesecake", uz: "Chizkeyk" },
      description: {
        ru: "Нью-Йоркский чизкейк с малиной",
        en: "New York cheesecake with raspberry",
        uz: "Malinali Nyu-York chizkeyk",
      },
      price: 35000,
      weight: 150,
      modifiers: [],
    },
    {
      id: "dish_avocado_toast",
      categoryId: "cat_breakfast",
      name: { ru: "Тост с авокадо", en: "Avocado toast", uz: "Avokadoli tost" },
      description: {
        ru: "Сурдоу с гуакамоле, яйцом пашот и черри",
        en: "Sourdough with guacamole, poached egg and cherry tomatoes",
        uz: "Surdou non, gvakamole, paxta tuxum va cherri pomidor",
      },
      price: 48000,
      weight: 280,
      modifiers: [],
    },
    {
      id: "dish_granola",
      categoryId: "cat_breakfast",
      name: { ru: "Гранола с йогуртом", en: "Granola with yogurt", uz: "Yogurtli granola" },
      description: {
        ru: "Домашняя гранола с греческим йогуртом и ягодами",
        en: "Homemade granola with Greek yogurt and berries",
        uz: "Yunon yogurti va rezavorlar bilan uy granolasi",
      },
      price: 38000,
      weight: 250,
      modifiers: [],
    },
  ],
};

export const MOCK_MENUS: Record<string, MockMenuComposition> = {
  rst_plov_center: plovCenterMenu,
  rst_tashkent_grill: tashkentGrillMenu,
  rst_black_bean: blackBeanMenu,
};

/**
 * Stop list per restaurant. An item that is NOT in the list is considered
 * available without limits, mirroring the Delever convention.
 */
export const MOCK_AVAILABILITY: Record<string, MockMenuAvailability> = {
  rst_plov_center: {
    items: [{ id: "dish_plov_devzira", stock: 0 }],
    modifiers: [],
  },
  rst_tashkent_grill: {
    items: [{ id: "dish_kebab_liver", stock: 0 }],
    modifiers: [],
  },
  rst_black_bean: {
    items: [{ id: "dish_avocado_toast", stock: 0 }],
    modifiers: [],
  },
};
