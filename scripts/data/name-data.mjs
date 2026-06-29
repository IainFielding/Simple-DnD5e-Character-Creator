/**
 * Curated fantasy name tables for the random name generator, plus the map that
 * routes a species' dnd5e `system.identifier` to one of these styles.
 *
 * Every name here is original to this module — no real-world corpus and no
 * third-party dataset is used, so the tables ship cleanly under the module's own
 * licence. Pure data: this file imports nothing and touches neither the DOM nor
 * any Application, so it can be read from any layer (and unit-tested in isolation).
 *
 * Each style is `{ male, female, surnames }`. A style with an empty `surnames`
 * pool yields a single given name (e.g. warforged designations); the generator
 * falls back to the merged given pools when the requested gender has no entries.
 *
 * Worlds and other modules can add or override styles without editing this file
 * by assigning to `CONFIG.SOGROM.nameStyles` / `CONFIG.SOGROM.nameAliases`; see
 * {@link module:data/name-generator}.
 */

/** style id -> { male: string[], female: string[], surnames: string[] } */
export const NAME_STYLES = {
  // A deliberately setting-neutral "fantasy human" voice — not modern/real-world.
  human: {
    male: ["Aldric", "Aldous", "Alaric", "Berrin", "Bran", "Cedric", "Corwin", "Doran", "Dunstan", "Edmund", "Emrys", "Fendrel", "Garrick", "Godwin", "Hadrian", "Halvard", "Ivo", "Joram", "Jarl", "Kellan", "Konrad", "Leofric", "Merrick", "Nevin", "Osric", "Perrin", "Quillon", "Roderic", "Reeve", "Sten", "Theobald", "Tomas", "Ulric", "Varic", "Willem", "Wymond"],
    female: ["Adela", "Alys", "Bridda", "Bronwen", "Carys", "Cygna", "Dervla", "Edytha", "Elspeth", "Genevra", "Gwenna", "Helsa", "Ilse", "Isolde", "Junia", "Kerensa", "Linnet", "Lirien", "Maren", "Marwen", "Nesta", "Odile", "Petra", "Rhian", "Rowena", "Saewynn", "Sefa", "Talia", "Thessaly", "Una", "Verity", "Wenna", "Ysolde", "Yvaine", "Caedwen", "Morwenna"],
    surnames: ["Ashmoor", "Brackwater", "Caldwell", "Fenwick", "Harrow", "Locke", "Marsh", "Thornbury", "Vance", "Westgate", "Aldermoor", "Blackbriar", "Cobbleford", "Dunmore", "Eastlake", "Fairweather", "Greycastle", "Holloway", "Ironwood", "Larkspur", "Merribourne", "Norcross", "Oakhurst", "Pendry", "Ravenscroft", "Stonewall", "Tanwick", "Underhill", "Whitlock", "Yarrow"]
  },

  // Liquid consonants, soft vowels, the occasional apostrophe; flowing house names.
  elf: {
    male: ["Aelar", "Adran", "Aramil", "Berrian", "Caelynn", "Carric", "Dayereth", "Enialis", "Erevan", "Faelar", "Fivin", "Galinndan", "Hadarai", "Heian", "Himo", "Immeral", "Ivellios", "Korfel", "Laucian", "Lamlis", "Mindartis", "Naal", "Nutae", "Paelias", "Peren", "Quarion", "Riardon", "Rolen", "Soveliss", "Suhnae", "Sylvar", "Thamior", "Tharivol", "Uthemar", "Varis", "Aelrindel"],
    female: ["Adrie", "Althaea", "Anastrianna", "Antinua", "Bethrynna", "Birel", "Caelynn", "Dara", "Drusilia", "Enna", "Faeryl", "Felosial", "Iliana", "Ielenia", "Jelenneth", "Keyleth", "Leshanna", "Lia", "Mialee", "Merethyl", "Naivara", "Quelenna", "Quillathe", "Sariel", "Shanairra", "Shava", "Silaqui", "Theirastra", "Thia", "Vadania", "Valanthe", "Xanaphia", "Ysane", "Yrlanna", "Aravae", "Lerissa"],
    surnames: ["Amakiir", "Amastacia", "Galanodel", "Holimion", "Ilphelkiir", "Liadon", "Meliamne", "Nailo", "Siannodel", "Xiloscient", "Aloro", "Caerdonel", "Eathalena", "Goltorah", "Hawksong", "Ilizimmer", "Koehlanna", "Mistwalker", "Moonwhisper", "Nightbreeze", "Raulnor", "Silverfrond", "Starflower", "Truesilver", "Vaeren", "Withrender", "Yescalle"]
  },

  // Hard stops, doubled consonants, and clan surnames.
  dwarf: {
    male: ["Adrik", "Alberich", "Baern", "Barendd", "Brottor", "Dain", "Darrak", "Delg", "Eberk", "Einkil", "Fargrim", "Flint", "Gardain", "Harbek", "Kildrak", "Morgran", "Orsik", "Oskar", "Rangrim", "Rurik", "Taklinn", "Thoradin", "Thorin", "Tordek", "Traubon", "Travok", "Ulfgar", "Veit", "Vondal", "Brom", "Durgan", "Korrun", "Norbus", "Skalf", "Throdin", "Bromgar"],
    female: ["Amber", "Artin", "Audhild", "Bardryn", "Dagnal", "Diesa", "Eldeth", "Falkrunn", "Finellen", "Gunnloda", "Gurdis", "Helja", "Hlin", "Kathra", "Kristryd", "Ilde", "Liftrasa", "Mardred", "Riswynn", "Sannl", "Torbera", "Torgga", "Vistra", "Aelgifu", "Brunnhild", "Dwalia", "Gerd", "Hilde", "Kira", "Lodda", "Nala", "Ovina", "Sigrun", "Thyra", "Vigdis", "Yurgen"],
    surnames: ["Balderk", "Battlehammer", "Brawnanvil", "Dankil", "Fireforge", "Frostbeard", "Gorunn", "Holderhek", "Ironfist", "Loderr", "Lutgehr", "Rumnaheim", "Strakeln", "Torunn", "Ungart", "Anvilmar", "Coalhewer", "Deepdelve", "Emberforge", "Goldvein", "Grimblade", "Hammerfall", "Ironhelm", "Karrduum", "Oremantle", "Stonehand", "Thunderbrew", "Undermountain", "Warmaul", "Yundrok"]
  },

  // Homely given names paired with warm, earthy family names.
  halfling: {
    male: ["Alton", "Ander", "Bernie", "Bobbin", "Cade", "Callus", "Corrin", "Dannad", "Danniel", "Eddie", "Egart", "Eldon", "Errich", "Finnan", "Garret", "Gob", "Lindal", "Lyle", "Merric", "Milo", "Mungo", "Nebin", "Osborn", "Ostran", "Perrin", "Pip", "Poppy", "Quentin", "Reed", "Roscoe", "Shardon", "Tye", "Ulmo", "Wellby", "Wendel", "Finch"],
    female: ["Andry", "Bree", "Callie", "Cora", "Euphemia", "Gynnie", "Harriet", "Jillian", "Lavinia", "Lidda", "Maegan", "Marigold", "Merla", "Myria", "Nedda", "Nikki", "Nora", "Olivia", "Paela", "Pearl", "Penny", "Portia", "Robbie", "Rose", "Saral", "Seraphina", "Shaena", "Stacee", "Tansy", "Trym", "Vani", "Verna", "Wilow", "Cherry", "Dell", "Petunia"],
    surnames: ["Brushgather", "Goodbarrel", "Greenbottle", "Highhill", "Hilltopple", "Leagallow", "Tealeaf", "Thorngage", "Tosscobble", "Underbough", "Appleblossom", "Brambletoe", "Copperkettle", "Dewfoot", "Fairwind", "Greenmeadow", "Honeypot", "Littlefoot", "Mossbarrow", "Nimblefinger", "Oakbottom", "Proudfellow", "Quickstep", "Reedwhistle", "Sweetwater", "Thistledown", "Warmhearth", "Wildbloom", "Wobblefoot", "Yellowknoll"]
  },

  // Whimsical, busy, often double-syllabled given names; nickname-ish surnames.
  gnome: {
    male: ["Alston", "Alvyn", "Boddynock", "Brocc", "Burgell", "Dimble", "Eldon", "Erky", "Fonkin", "Frug", "Gerbo", "Gimble", "Glim", "Jebeddo", "Kellen", "Namfoodle", "Orryn", "Pock", "Roondar", "Seebo", "Sindri", "Warryn", "Wrenn", "Zaffrab", "Zook", "Bimble", "Cogsly", "Fibblestib", "Gallywix", "Nim", "Sprocket", "Tinder", "Whizzle", "Zibbick", "Quill", "Fenwick"],
    female: ["Bimpnottin", "Breena", "Caramip", "Carlin", "Donella", "Duvamil", "Ella", "Ellyjobell", "Ellywick", "Lilli", "Loopmottin", "Lorilla", "Mardnab", "Nissa", "Nyx", "Oda", "Orla", "Roywyn", "Shamil", "Tana", "Waywocket", "Zanna", "Bizzle", "Cogwen", "Fizzwidget", "Glimmer", "Jinx", "Mella", "Niddle", "Pippa", "Quenna", "Sproket", "Tinka", "Whirla", "Zelda", "Zibilna"],
    surnames: ["Beren", "Daergel", "Folkor", "Garrick", "Nackle", "Murnig", "Ningel", "Raulnor", "Scheppen", "Timbers", "Turen", "Camberwick", "Coggspindle", "Copperbottom", "Fiddlewidget", "Gearloose", "Glitterspark", "Greasethumb", "Knappenspring", "Leatherbritches", "Nimblecog", "Quickwrench", "Sparkfizzle", "Steamwhistle", "Tinkertop", "Trinketspring", "Wheezleworth", "Whirligig", "Wobbleknock", "Zappercrank"]
  },

  // Sharp, draconic given names; clan names carried with pride.
  dragonborn: {
    male: ["Arjhan", "Balasar", "Bharash", "Donaar", "Fenkesh", "Garrik", "Ghesh", "Greethen", "Haran", "Heskan", "Jheren", "Kaladan", "Kriv", "Maldrek", "Medrash", "Mehen", "Nadarr", "Narghul", "Orzheth", "Pandjed", "Patrin", "Pharanx", "Rezkel", "Rhogar", "Shamash", "Shedinn", "Suresh", "Tarhun", "Threvik", "Torinn", "Urlax", "Vandren", "Vrakor", "Xornath", "Zarvox", "Zharzul"],
    female: ["Akra", "Biri", "Daar", "Farideh", "Harann", "Havilar", "Jheri", "Kava", "Korinn", "Mishann", "Nala", "Perra", "Raiann", "Sora", "Surina", "Thava", "Uadjit", "Anaxis", "Bexen", "Chassyth", "Daenara", "Esha", "Halar", "Irithel", "Jorra", "Khoradi", "Lashann", "Myrra", "Nesryn", "Orinda", "Ravara", "Sethra", "Thyrra", "Vezera", "Yrjala", "Zephira"],
    surnames: ["Clethtinthiallor", "Daardendrian", "Delmirev", "Drachedandion", "Fenkenkabradon", "Kerrhylon", "Kimbatuul", "Linxakasendalor", "Myastan", "Nemmonis", "Norixius", "Ophinshtalajiir", "Prexijandilin", "Shestendeliath", "Turnuroth", "Verthisathurgiesh", "Yarjerit", "Akthaljasiir", "Belaxus", "Chalandra", "Dracoroth", "Embrethar", "Ghaazenvenk", "Hauthrandar", "Jerynomon", "Kepeshkmolik", "Mordennkel", "Ozzrenkoth", "Velkaroth", "Zoradomir"]
  },

  // Infernal given names alongside Common "virtue" names; rarely a family name.
  tiefling: {
    male: ["Akmenos", "Amnon", "Barakas", "Damakos", "Ekemon", "Iados", "Kairon", "Leucis", "Melech", "Mordai", "Morthos", "Pelaios", "Skamos", "Therai", "Antos", "Carrion", "Creed", "Dolor", "Fury", "Grief", "Iratu", "Karn", "Lazarus", "Mammon", "Nerul", "Phistys", "Quennar", "Ronove", "Sorrow", "Tarchon", "Vassago", "Wrath", "Xaphan", "Zagan", "Zephar", "Balor"],
    female: ["Akta", "Anakis", "Armara", "Astaro", "Bryseis", "Criella", "Damaia", "Decarabia", "Ea", "Kallista", "Lerissa", "Makaria", "Nemeia", "Orianna", "Phelaia", "Rieta", "Faith", "Glory", "Grace", "Hope", "Joy", "Lament", "Mercy", "Misery", "Poetry", "Prosper", "Solace", "Temperance", "Tribulation", "Verity", "Vigil", "Despair", "Ember", "Vesper", "Sorrow", "Mourn"],
    surnames: []
  },

  // Guttural, blunt given names; descriptive epithet surnames.
  "half-orc": {
    male: ["Dench", "Feng", "Gell", "Henk", "Holg", "Imsh", "Keth", "Krusk", "Mhurren", "Ront", "Shump", "Thokk", "Brakka", "Drogh", "Gorruk", "Harsk", "Jorgu", "Kruth", "Lurg", "Morto", "Narek", "Ogrash", "Ruthak", "Skarn", "Thuldar", "Ugrek", "Vorgan", "Warl", "Yazgash", "Zoruk", "Bregg", "Durth", "Grakk", "Murzol", "Snagg", "Throk"],
    female: ["Baggi", "Emen", "Engong", "Kansif", "Myev", "Neega", "Ovak", "Ownka", "Shautha", "Sutha", "Vola", "Yevelda", "Arna", "Brugha", "Creesha", "Dasha", "Greshka", "Hagga", "Iskra", "Krusha", "Lorga", "Murook", "Nazka", "Orvga", "Ruka", "Sharna", "Throga", "Ulga", "Veshka", "Wugga", "Yarka", "Zerga", "Drelka", "Gorsha", "Murza", "Brakla"],
    surnames: ["Bonebreaker", "Doomhowl", "Ironhide", "Skullcleaver", "Bloodfang", "Grimtusk", "Axebiter", "Bloodmaw", "Earthsplitter", "Foecrusher", "Gravelfist", "Hardskull", "Ironjaw", "Marrowtaker", "Nightreaver", "Ragehowl", "Scarback", "Skullsplitter", "Spinecrack", "Thornhide", "Warbringer", "Wolfsbane", "Wrathborn", "Bonechewer"]
  },

  // Full-orc voice — harsher than half-orc, clan/warband bynames.
  orc: {
    male: ["Drogan", "Garg", "Grom", "Karash", "Korga", "Lubash", "Morg", "Tharag", "Ugar", "Vrakk", "Zogthar", "Brughol", "Durz", "Gorthak", "Hrolf", "Karruk", "Lokar", "Maugh", "Nargol", "Orruk", "Rensh", "Shagrol", "Thurok", "Uthak", "Vorgun", "Zharkk", "Brokk", "Dremor", "Gashnak", "Hruth", "Kruul", "Margash", "Nokk", "Rugor", "Skarth", "Thokkar"],
    female: ["Creng", "Engong", "Greshka", "Murook", "Nagra", "Orla", "Shagra", "Ubag", "Vola", "Zenka", "Brughda", "Drazka", "Garsha", "Hrenna", "Kruska", "Lurgha", "Mogra", "Nazgha", "Orvka", "Reshka", "Shauka", "Thargha", "Ulka", "Vrenda", "Yorga", "Zhurka", "Brakta", "Dushka", "Gnasha", "Harsha", "Krenda", "Morgda", "Naksha", "Ronka", "Skarna", "Thugra"],
    surnames: ["Skullsplitter", "Eyegouger", "Throatripper", "Foecrusher", "Bloodmaw", "Bonegrinder", "Deathmaw", "Facebreaker", "Gutripper", "Headtaker", "Ironhowl", "Manslayer", "Necksnapper", "Ragefang", "Skinflayer", "Spinebreaker", "Tuskgore", "Warmonger", "Wrathmaw", "Doomfist", "Gloomtusk", "Hatecleaver", "Redhand", "Sundermaw"]
  },

  // A human-elf blend: graceful given names with grounded surnames.
  "half-elf": {
    male: ["Aramil", "Berrin", "Caelum", "Corwin", "Daeris", "Elwin", "Erevan", "Faelyn", "Galen", "Hadrian", "Ilian", "Joram", "Kael", "Lucan", "Maelon", "Naeris", "Orrin", "Quentin", "Riardon", "Soren", "Theron", "Ulric", "Varian", "Wystan", "Aelric", "Berevan", "Cedric", "Daelan", "Evrin", "Galeth", "Halvar", "Joren", "Kaelis", "Lyran", "Maric", "Veyric"],
    female: ["Anya", "Aravae", "Brisa", "Caelia", "Dara", "Elenwe", "Elaria", "Faela", "Genna", "Iliana", "Jessa", "Kira", "Lera", "Liriel", "Mara", "Naia", "Nessa", "Oriel", "Rowena", "Sariel", "Selene", "Thessaly", "Una", "Vaela", "Wenna", "Yssa", "Aeris", "Briala", "Caelynn", "Delwyn", "Elara", "Faylen", "Iridia", "Lyssa", "Maelis", "Saelra"],
    surnames: ["Amblecrown", "Galanodel", "Holborn", "Meliamne", "Sunbright", "Thornbury", "Windrivven", "Ashvale", "Brightwood", "Cearshade", "Dawngrove", "Embermoor", "Fallowmere", "Greenmantle", "Halfmoon", "Ivorel", "Larkmoor", "Mistral", "Nightdew", "Oakenshield", "Palebrook", "Quillsong", "Ravenshade", "Silverbrook", "Starfall", "Thornwell", "Underleaf", "Vaelora", "Whitethorn", "Wyndmere"]
  },

  // Celestial given names; luminous bynames.
  aasimar: {
    male: ["Cassiel", "Eliad", "Heshem", "Joren", "Micah", "Oziel", "Raphael", "Sariel", "Tariel", "Zaphkiel", "Adriel", "Barachiel", "Camael", "Dumiel", "Ezriel", "Gabriah", "Hadriel", "Israfel", "Jophiel", "Kemuel", "Lucael", "Muriel", "Nathaniel", "Oriel", "Pravuil", "Remiel", "Suriel", "Theliel", "Uriel", "Vehuel", "Yeriel", "Zachriel", "Anael", "Castiel", "Phanuel", "Selaphiel"],
    female: ["Aurelia", "Celesta", "Elysia", "Halcyon", "Liora", "Nethys", "Seraphine", "Sorath", "Vesper", "Zariel", "Amariah", "Beriah", "Cassia", "Donatha", "Elurael", "Galadriah", "Hosanna", "Ilora", "Jubilee", "Kerasel", "Luciel", "Mireille", "Nuriel", "Oriphel", "Pelagia", "Quietha", "Raziela", "Sephira", "Tamariel", "Uriela", "Valoria", "Yaeliel", "Anjelica", "Damariel", "Solenne", "Verael"],
    surnames: ["Dawnbringer", "Lightbearer", "Skyborn", "Hallowmere", "Auremon", "Brightveil", "Celestar", "Dawnward", "Emberhalo", "Goldenmere", "Halewing", "Hopebringer", "Lightward", "Lumenis", "Morningvale", "Nimbright", "Oathkeeper", "Pureheart", "Radiantmoor", "Solhaven", "Starborne", "Sunhallow", "Truelight", "Vesperdawn", "Whitehalo", "Auriel", "Beaconmoor", "Gracewind", "Lightspire", "Sanctus"]
  },

  // Birth name plus a clan name plus a self-chosen nickname feel; we use clan surnames.
  goliath: {
    male: ["Aukan", "Eglath", "Gae-Al", "Kavaki", "Lo-Kag", "Manneo", "Pao-Vek", "Thalai", "Vaunea", "Keothi", "Aukana", "Eglan", "Gauthak", "Ilikan", "Kaethal", "Lotharn", "Maveith", "Nalothi", "Oragh", "Paval", "Rauthi", "Skanar", "Tharos", "Uthal", "Vethan", "Aekan", "Brakan", "Dethan", "Gantar", "Harthal", "Kethran", "Lavak", "Methos", "Oranthi", "Ravan", "Thelan"],
    female: ["Aleitha", "Brunhilde", "Caelkna", "Gae-Akh", "Kuori", "Manea", "Nalla", "Orilo", "Thestraki", "Vaelra", "Aukea", "Dolatha", "Elathi", "Gauthi", "Ilethka", "Kavari", "Lonatha", "Marketh", "Nethaki", "Oraka", "Ravetha", "Sethari", "Thalka", "Uvitha", "Vaketha", "Aenka", "Brethi", "Daketha", "Gunhilda", "Hethari", "Karuna", "Methari", "Oletha", "Selka", "Thraketha", "Ulitha"],
    surnames: ["Anakalathai", "Elanithino", "Gathakanathi", "Kalagiano", "Thuliaga", "Vaakindi", "Aeltheath", "Brakanthal", "Gauthrakka", "Ilimaratha", "Kethanaki", "Lothakana", "Maventhio", "Nalagathra", "Oranthela", "Ravanthaki", "Skagathari", "Thelakanos", "Uvithakal", "Vethanaria", "Aukanthio", "Daravethka", "Korathagal", "Tharanikos"]
  },

  // Feline, lilting names; a single name, no surname.
  tabaxi: {
    male: ["Cloud on the Mountaintop", "Five Timber", "Jade Shoe", "Left-Handed Hummingbird", "Smoking Mirror", "Sand Strider", "Quick Claw", "Whisper Wind", "Black Tongue", "Dusk Runner", "Flint Eye", "Grey Pelt", "Hidden Moon", "Iron Whisker", "Long Shadow", "Night Prowler", "Painted Tail", "River Stone", "Silent Pounce", "Storm Whisker", "Tall Grass", "Two Moons", "Wandering Star", "Yellow Fang"],
    female: ["Dancing in Storms", "Gentle Rain", "Morning Mist", "Skirts the Ash", "Two Dry Cloaks", "Quiet Step", "Bright Star", "Soft Paw", "Amber Eyes", "Autumn Leaf", "Curled Tail", "Dawn Whisker", "Ember Glow", "Falling Petal", "Golden Dusk", "Hollow Reed", "Lily Pad", "Moonlit Pool", "Pale Feather", "Singing Brook", "Sleek Shadow", "Velvet Night", "Whispering Sand", "Willow Bend"],
    surnames: []
  },

  // Goblin / goblinoid — clipped, snarling given names.
  goblinoid: {
    male: ["Drubbus", "Frik", "Gnar", "Hruggek", "Mubo", "Nizz", "Rikk", "Skib", "Thru", "Zibba", "Brak", "Dagnot", "Fizzik", "Gribbit", "Hokk", "Jukk", "Krak", "Liznok", "Murg", "Nakk", "Pogg", "Rasp", "Snikt", "Trog", "Urzz", "Vigg", "Wrenk", "Yark", "Zogg", "Mez"],
    female: ["Brakka", "Eega", "Gritz", "Lhupo", "Meeza", "Nokk", "Riza", "Snik", "Vrek", "Yibba", "Azka", "Crinn", "Drez", "Fenn", "Gixx", "Hessa", "Jizz", "Krik", "Lirra", "Mizka", "Nirr", "Pska", "Qurr", "Resk", "Skritt", "Tezz", "Uzga", "Vixx", "Wibb", "Zira"],
    surnames: []
  },

  // Kobold — yippy, draconic-diminutive names; tribe bynames.
  kobold: {
    male: ["Gax", "Irhtos", "Kib", "Molik", "Pextlitz", "Sniss", "Tikk", "Urkek", "Vendril", "Zix", "Dax", "Ekess", "Girt", "Hix", "Jakko", "Kobo", "Lirk", "Meeko", "Nibs", "Orik", "Pik", "Quix", "Rasp", "Skitt", "Tazz", "Vex", "Wirt", "Yip", "Zev", "Snik"],
    female: ["Ekka", "Frix", "Girka", "Hesski", "Iki", "Jezz", "Kitik", "Lissa", "Meri", "Nima", "Orla", "Prix", "Quik", "Rikka", "Sevri", "Tazzi", "Urka", "Vrenna", "Wixa", "Yera", "Zissa", "Bixx", "Drika", "Fessi", "Klikka", "Nessi", "Pikka", "Skirra", "Tikka", "Zerra"],
    surnames: ["Deepscale", "Gravelclaw", "Mudwing", "Stonetooth", "Ashscale", "Cinderclaw", "Dampcave", "Emberwing", "Flintscale", "Gloomtail", "Rockbiter", "Tunneltooth"]
  },

  // Lizardfolk — descriptive Draconic names; no surname.
  lizardfolk: {
    male: ["Aryte", "Baeshra", "Garurt", "Irhtos", "Kepesk", "Othok", "Sauriv", "Tarjak", "Usk", "Valnan", "Drathiss", "Eshkek", "Gholar", "Hessk", "Issar", "Korakk", "Maruk", "Nessuk", "Orruk", "Perrok", "Quetz", "Razak", "Sythar", "Tsekk", "Uthar", "Veskar", "Wyrok", "Xathar", "Yssir", "Zharak"],
    female: ["Achuak", "Emolo", "Irkan", "Kethsk", "Olothk", "Sessih", "Thakka", "Uthkar", "Vesh", "Wakanu", "Asha", "Brekka", "Drassa", "Eshka", "Ghessa", "Hessith", "Issuk", "Karassa", "Lessith", "Massuk", "Nethka", "Orrissa", "Ressuk", "Sythara", "Tassuk", "Vessith", "Wessuk", "Yssara", "Zessa", "Krethka"],
    surnames: []
  },

  // Genasi — names echo their elemental heritage; sweeping bynames.
  genasi: {
    male: ["Cinder", "Ash", "Basalt", "Blaze", "Brook", "Cliff", "Coal", "Cyclone", "Drift", "Ember", "Flint", "Gale", "Geyser", "Granite", "Gust", "Magma", "Mistral", "Onyx", "Pyre", "Quartz", "Rime", "Scorch", "Sirocco", "Slate", "Surge", "Talus", "Tempest", "Torrent", "Vapor", "Zephyr"],
    female: ["Aria", "Aurora", "Brisa", "Calida", "Cinder", "Coral", "Ember", "Flara", "Gaila", "Ignia", "Lumen", "Marina", "Mistral", "Nixie", "Pyra", "Ondine", "Quilla", "Rilla", "Saffira", "Seren", "Sirena", "Talia", "Tempest", "Terra", "Undine", "Vesta", "Vela", "Zephyra", "Zaira", "Mira"],
    surnames: ["Emberkin", "Stormborn", "Deepcurrent", "Stonehollow", "Ashwind", "Cinderborn", "Dustwalker", "Flamekin", "Stillwater", "Tidewrack", "Windrider", "Cragheart"]
  },

  // Warforged — chosen designations, often a single descriptive name.
  warforged: {
    male: ["Anvil", "Bastion", "Cinder", "Forge", "Hammer", "Iron", "Keystone", "Lock", "Mark", "Vault", "Bolt", "Brass", "Bulwark", "Cog", "Cordon", "Crucible", "Ember", "Flint", "Gauge", "Girder", "Lattice", "Ledger", "Mortar", "Onyx", "Piston", "Rivet", "Sentinel", "Spanner", "Tally", "Temper"],
    female: ["Anvil", "Bastion", "Cinder", "Forge", "Hammer", "Iron", "Keystone", "Lock", "Mark", "Vault", "Bolt", "Brass", "Bulwark", "Cog", "Cordon", "Crucible", "Ember", "Flint", "Gauge", "Girder", "Lattice", "Ledger", "Mortar", "Onyx", "Piston", "Rivet", "Sentinel", "Spanner", "Tally", "Temper"],
    surnames: []
  },

  // --- Eberron ---

  // Changeling — short, fluid personas adopted and discarded at will; no fixed surname.
  changeling: {
    male: ["Bin", "Cas", "Dell", "Esk", "Fane", "Gix", "Harl", "Ix", "Jary", "Kell", "Lun", "Mer", "Nix", "Oth", "Pell", "Quor", "Rix", "Sed", "Tane", "Urm", "Ves", "Wix", "Yarn", "Zel", "Bram", "Dro", "Fenn", "Gisk", "Holt", "Marn"],
    female: ["Ana", "Brie", "Cyn", "Dris", "Esi", "Fay", "Gwel", "Hesh", "Isa", "Jyn", "Kira", "Liss", "Mira", "Nels", "Oona", "Pril", "Quill", "Risa", "Sable", "Tace", "Une", "Vesp", "Wyn", "Yara", "Zin", "Bex", "Dova", "Esme", "Lenna", "Lune"],
    surnames: []
  },

  // Shifter — grounded, bestial given names; descriptive pack epithets.
  shifter: {
    male: ["Bram", "Coll", "Drev", "Eron", "Fenn", "Grix", "Harn", "Jarl", "Kesh", "Lash", "Morr", "Nash", "Orin", "Pell", "Rurik", "Skar", "Torv", "Varn", "Wulf", "Yorn", "Brak", "Cael", "Dunn", "Greth", "Hollow", "Krev", "Lurn", "Roak", "Sten", "Vesk"],
    female: ["Asha", "Bril", "Cova", "Dell", "Esha", "Fenna", "Gwyn", "Hesta", "Isen", "Jora", "Kessa", "Lira", "Mura", "Nessa", "Ona", "Pell", "Resa", "Sava", "Tova", "Una", "Vesh", "Wren", "Yara", "Brisa", "Dova", "Eska", "Fenra", "Lyssa", "Mira", "Senna"],
    surnames: ["Longstride", "Sharptooth", "Swiftclaw", "Nightnose", "Ironpelt", "Quickfang", "Bramblehide", "Keeneye", "Wildmane", "Greyfur", "Strongback", "Lowtrack"]
  },

  // Kalashtar — flowing compound names echoing a bonded quori spirit; a single name, no surname.
  kalashtar: {
    male: ["Adamar", "Belavar", "Coratash", "Davandi", "Elathan", "Falavar", "Halamaly", "Indri", "Jolarah", "Kalavash", "Lavandri", "Maravar", "Nevashi", "Oradan", "Pavandri", "Quoralan", "Ravashai", "Solavar", "Talavash", "Uradan", "Velandri", "Wovashai", "Yolaran", "Avantash", "Belaran", "Coravash", "Dolandri", "Elavash", "Halandri", "Ovaran"],
    female: ["Adari", "Belashai", "Coravi", "Davari", "Elavi", "Falashai", "Halaly", "Indravi", "Jolashai", "Kalavi", "Lavashai", "Maravi", "Nevari", "Oravi", "Pavashai", "Quoravi", "Ravari", "Solashai", "Talavi", "Uravi", "Velashai", "Wovari", "Yolavi", "Avari", "Belavi", "Coravari", "Dolashai", "Elari", "Halavi", "Ovashai"],
    surnames: []
  },

  // --- Ravenloft lineages ---

  // Dhampir — gothic, aristocratic given names; old Barovian house names.
  dhampir: {
    male: ["Aleksandr", "Anton", "Casimir", "Dmitri", "Emeric", "Florian", "Gavril", "Henrik", "Ivar", "Janos", "Kristoff", "Lucian", "Mircea", "Nikolai", "Ordin", "Petru", "Radu", "Sorin", "Tobias", "Ulric", "Vasile", "Wilhelm", "Yorick", "Aldric", "Bogdan", "Drazen", "Mihail", "Stefan", "Tomas", "Viktor"],
    female: ["Anica", "Carmilla", "Doina", "Elena", "Floriana", "Greta", "Ileana", "Jelena", "Katarina", "Ludmila", "Marishka", "Nadia", "Ottilie", "Petra", "Rozalia", "Sasha", "Tatyana", "Ursula", "Vasilica", "Wanda", "Yelena", "Anya", "Dragana", "Elise", "Mina", "Sabina", "Vesna", "Zora", "Liesl", "Mirela"],
    surnames: ["Dragovich", "Marek", "Lazarescu", "Stoyan", "Petrov", "Vadoma", "Radek", "Novak", "Vasiliev", "Mirov", "Cantemir", "Dalca", "Grigore", "Iliescu", "Karnstein", "Ladislav", "Mihnea", "Orlok", "Strigoi", "Tepesch", "Valakovic", "Zoran", "Brashov", "Cernat"]
  },

  // Hexblood — eerie, fey- and hag-touched given names; witch-marked bynames.
  hexblood: {
    male: ["Alder", "Bram", "Corvin", "Crane", "Edric", "Fenwick", "Gorse", "Hollis", "Ivo", "Jasper", "Linden", "Mordecai", "Nettle", "Orin", "Pike", "Rowan", "Sloe", "Thorne", "Vael", "Wren", "Ash", "Briar", "Cael", "Dorian", "Elm", "Hawthorn", "Marsh", "Ren", "Sorrel", "Yarrow"],
    female: ["Agatha", "Briony", "Cailin", "Dahlia", "Esme", "Fern", "Gisla", "Hazel", "Iris", "Juniper", "Lilith", "Morgaine", "Nessa", "Ondine", "Poppy", "Ravenna", "Sabine", "Tansy", "Una", "Verbena", "Willa", "Vesper", "Bryony", "Cordelia", "Elspeth", "Hester", "Marrow", "Rue", "Sable", "Wisteria"],
    surnames: ["Nightshade", "Thornwood", "Bramblehex", "Mirewillow", "Crowsfeather", "Hollowoak", "Witchbane", "Ashthorn", "Gravemoss", "Hagsworn", "Ravenmark", "Bonebriar"]
  },

  // Reborn — archaic given names from a half-remembered past; grave-touched epithets.
  reborn: {
    male: ["Ambrose", "Barnaby", "Cornelius", "Drystan", "Edmund", "Faramund", "Gideon", "Hugh", "Isembard", "Jerome", "Lazarus", "Mortimer", "Nathaniel", "Osric", "Percival", "Quintus", "Roland", "Silas", "Thaddeus", "Ulric", "Valdemar", "Wystan", "Aldous", "Cedric", "Gilbert", "Lucan", "Phineas", "Reginald", "Tobias", "Walter"],
    female: ["Agnes", "Beatrix", "Cecily", "Drusilla", "Edith", "Felicia", "Genevieve", "Hester", "Isolde", "Josephine", "Lavinia", "Margery", "Nerissa", "Ottilia", "Prudence", "Rosalind", "Sibyl", "Theodora", "Ursula", "Vespera", "Winifred", "Adelaide", "Clemence", "Dorothea", "Eudora", "Honoria", "Maude", "Philippa", "Rowena", "Sabella"],
    surnames: ["the Pale", "Gravewise", "the Ashen", "Hollowborn", "Stillbreath", "the Mourner", "Coldhand", "Lastlight", "Gravewalker", "Witherborn", "Dustmourn", "Palewatch"]
  },

  // Fallback for any unmapped species — a broad, neutral fantasy voice, deliberately the largest pool.
  default: {
    male: ["Aric", "Bram", "Caelum", "Doran", "Eron", "Fendrel", "Galdor", "Halric", "Joren", "Kael", "Soren", "Theron", "Aldan", "Borin", "Calder", "Daric", "Edric", "Faelin", "Gareth", "Hadon", "Ilric", "Jovan", "Korin", "Larem", "Maric", "Nerian", "Orin", "Perrin", "Quill", "Raen", "Sevrin", "Talen", "Ulric", "Varic", "Wystan", "Aldric", "Bevan", "Cael", "Doren", "Emeric", "Faron", "Gildas", "Haldor", "Ivor", "Jarek", "Kelvar", "Loran", "Merek", "Noren", "Phelan", "Rowan", "Serik", "Tomar", "Veylin"],
    female: ["Alina", "Brisa", "Caelia", "Dara", "Elara", "Fenna", "Iria", "Lyra", "Mira", "Nessa", "Sela", "Wren", "Aelis", "Aria", "Brenna", "Bria", "Calla", "Cora", "Daevia", "Delwyn", "Eira", "Elys", "Faye", "Fiora", "Genna", "Gwyneth", "Halia", "Hesper", "Ilda", "Iola", "Juna", "Kaela", "Lira", "Liora", "Maelis", "Maeve", "Nira", "Nyssa", "Orla", "Oriel", "Petra", "Riala", "Rina", "Saela", "Senna", "Talia", "Tamsin", "Una", "Vaela", "Vesna", "Wenna", "Yara", "Ysla", "Zinna"],
    surnames: ["Ashfell", "Brightwood", "Duskwind", "Emberfall", "Hollowmere", "Ravensworn", "Stormcrest", "Wildemoor", "Amberhill", "Blackfen", "Briarwood", "Cinderhall", "Dawnmere", "Eastmarch", "Fairholt", "Frostvale", "Greymoor", "Hartwell", "Ironvale", "Larkhollow", "Mistvale", "Nightingale", "Oakenfell", "Pinehurst", "Quarryhill", "Ravenmoor", "Redhollow", "Silverdale", "Stagmoor", "Thornfield", "Underwood", "Valebrook", "Westwind", "Whitethorn", "Wyrmwood", "Yewdale", "Ashbourne", "Coldwater", "Deepfen", "Elderglen", "Foxglove", "Grimwald", "Marshwick", "Thistlewood", "Wolfsbane"]
  }
};

/**
 * Maps a species' dnd5e `system.identifier` to a style key in {@link NAME_STYLES}.
 * Lineage variants collapse to their parent style (e.g. every elf identifier -> "elf").
 * An identifier absent here falls through to "default".
 */
export const SPECIES_STYLE_ALIASES = {
  human: "human", variant: "human",
  elf: "elf", "high-elf": "elf", "wood-elf": "elf", drow: "elf", "dark-elf": "elf", eladrin: "elf", "sea-elf": "elf", "shadar-kai": "elf",
  dwarf: "dwarf", "hill-dwarf": "dwarf", "mountain-dwarf": "dwarf", duergar: "dwarf",
  halfling: "halfling", lightfoot: "halfling", "lightfoot-halfling": "halfling", stout: "halfling", "stout-halfling": "halfling", ghostwise: "halfling",
  gnome: "gnome", "forest-gnome": "gnome", "rock-gnome": "gnome", "deep-gnome": "gnome", svirfneblin: "gnome",
  dragonborn: "dragonborn",
  tiefling: "tiefling",
  "half-orc": "half-orc",
  orc: "orc",
  "half-elf": "half-elf",
  aasimar: "aasimar",
  goliath: "goliath", "goliath-2024": "goliath",
  tabaxi: "tabaxi",
  goblin: "goblinoid", goblinoid: "goblinoid", hobgoblin: "goblinoid", bugbear: "goblinoid",
  kobold: "kobold",
  lizardfolk: "lizardfolk",
  genasi: "genasi", "air-genasi": "genasi", "earth-genasi": "genasi", "fire-genasi": "genasi", "water-genasi": "genasi",
  warforged: "warforged",
  // Eberron
  changeling: "changeling", shifter: "shifter", "beasthide": "shifter", "longtooth": "shifter", "swiftstride": "shifter", "wildhunt": "shifter", kalashtar: "kalashtar",
  // Ravenloft lineages
  dhampir: "dhampir", hexblood: "hexblood", reborn: "reborn"
};
