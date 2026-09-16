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
 * Coverage: every species published by the content modules this module reads — the
 * 2014 and 2024 system packs, Player's Handbook, Eberron: Forge of the Artificer,
 * Heroes of the Borderlands, Ravenloft: Heroes of Horror, the DM's Toolkit species
 * pack (Spelljammer/Lorwyn/Ravnica/Planescape reprints), Theros and Wild Beyond the
 * Witchlight — resolves to a style below; see {@link SPECIES_STYLE_ALIASES}. Ember
 * is deliberately absent: its builder owns naming, so the generator never runs there.
 * Every given-name pool holds at least twenty entries, and every non-empty surname
 * pool at least twelve, so no style repeats itself noticeably in play.
 *
 * Worlds and other modules can add or override styles without editing this file
 * by assigning to `CONFIG.SOGROM.nameStyles` / `CONFIG.SOGROM.nameAliases`; see
 * {@link module:data/name-generator}.
 */

/** style id -> { male: string[], female: string[], surnames: string[] } */
export const NAME_STYLES = {
  // A deliberately setting-neutral "fantasy human" voice — not modern/real-world.
  human: {
    male: ["Aldric", "Aldous", "Alaric", "Berrin", "Bran", "Cedric", "Corwin", "Doran", "Dunstan", "Edmund", "Emrys", "Fendrel", "Garrick", "Godwin", "Hadrian", "Halvard", "Ivo", "Joram", "Jarl", "Kellan", "Konrad", "Leofric", "Merrick", "Nevin", "Osric", "Perrin", "Quillon", "Roderic", "Reeve", "Sten", "Theobald", "Tomas", "Ulric", "Varic", "Willem", "Wymond", "Aldwin", "Anselm", "Baldric", "Bertram", "Brannoc", "Caldus", "Cuthbert", "Danric", "Dervan", "Eadric", "Ewart", "Falken", "Garreth", "Gerolt", "Hamon", "Hollis", "Ingar", "Jorund", "Kenrick", "Lambert", "Lorcan", "Maldwyn", "Norris", "Odric", "Pellam", "Rainer", "Rowan", "Sigward", "Sylas", "Tarrant", "Thaddeus", "Torvald", "Uther", "Vasher", "Weylin", "Yorath"],
    female: ["Adela", "Alys", "Bridda", "Bronwen", "Carys", "Cygna", "Dervla", "Edytha", "Elspeth", "Genevra", "Gwenna", "Helsa", "Ilse", "Isolde", "Junia", "Kerensa", "Linnet", "Lirien", "Maren", "Marwen", "Nesta", "Odile", "Petra", "Rhian", "Rowena", "Saewynn", "Sefa", "Talia", "Thessaly", "Una", "Verity", "Wenna", "Ysolde", "Yvaine", "Caedwen", "Morwenna", "Aelfwyn", "Amice", "Avelina", "Beatrix", "Brannagh", "Cwen", "Delwyn", "Eadgyth", "Elowen", "Emmeline", "Fenella", "Godiva", "Gwenllian", "Hawise", "Idony", "Isobel", "Jocosa", "Katryn", "Leofgyth", "Lowri", "Maeva", "Margery", "Melisande", "Nerys", "Orlaith", "Perrine", "Rosamund", "Sabine", "Seren", "Sibylla", "Tegan", "Thomasin", "Ursel", "Vivienne", "Winfreda", "Ysbail"],
    surnames: ["Ashmoor", "Brackwater", "Caldwell", "Fenwick", "Harrow", "Locke", "Marsh", "Thornbury", "Vance", "Westgate", "Aldermoor", "Blackbriar", "Cobbleford", "Dunmore", "Eastlake", "Fairweather", "Greycastle", "Holloway", "Ironwood", "Larkspur", "Merribourne", "Norcross", "Oakhurst", "Pendry", "Ravenscroft", "Stonewall", "Tanwick", "Underhill", "Whitlock", "Yarrow", "Ashcroft", "Barrowdale", "Bellweather", "Briarholt", "Cartwright", "Coldridge", "Duskmill", "Edgemoor", "Farrowgate", "Ferrisham", "Gravesend", "Hallowford", "Hartstone", "Highbarrow", "Kingsley", "Lampwick", "Millward", "Mossbank", "Netherby", "Orchardly", "Penhallow", "Quarryman", "Ridgeworth", "Saltmarch", "Sedgewick", "Stormhold", "Thatchley", "Verringer", "Wainwright", "Windermere"]
  },

  // Liquid consonants, soft vowels, the occasional apostrophe; flowing house names.
  elf: {
    male: ["Aelar", "Adran", "Aramil", "Berrian", "Caelynn", "Carric", "Dayereth", "Enialis", "Erevan", "Faelar", "Fivin", "Galinndan", "Hadarai", "Heian", "Himo", "Immeral", "Ivellios", "Korfel", "Laucian", "Lamlis", "Mindartis", "Naal", "Nutae", "Paelias", "Peren", "Quarion", "Riardon", "Rolen", "Soveliss", "Suhnae", "Sylvar", "Thamior", "Tharivol", "Uthemar", "Varis", "Aelrindel", "Aerendyl", "Aelvar", "Ahvir", "Aravir", "Baelen", "Caladrel", "Celedor", "Cithreth", "Daeril", "Elandor", "Elrohan", "Eressan", "Faerwyn", "Fyrenal", "Galadan", "Gwynlas", "Haelian", "Ilthuryn", "Ithronel", "Kaelthir", "Larethian", "Lorandel", "Maelithar", "Naeryndam", "Neralis", "Ollandir", "Phaendar", "Qualinos", "Raelthir", "Sarandel", "Selvyn", "Taeral", "Theniel", "Ulvarin", "Vaeleron", "Ysilvar"],
    female: ["Adrie", "Althaea", "Anastrianna", "Antinua", "Bethrynna", "Birel", "Caelynn", "Dara", "Drusilia", "Enna", "Faeryl", "Felosial", "Iliana", "Ielenia", "Jelenneth", "Keyleth", "Leshanna", "Lia", "Mialee", "Merethyl", "Naivara", "Quelenna", "Quillathe", "Sariel", "Shanairra", "Shava", "Silaqui", "Theirastra", "Thia", "Vadania", "Valanthe", "Xanaphia", "Ysane", "Yrlanna", "Aravae", "Lerissa", "Aelene", "Ahinar", "Alathea", "Amaryllis", "Arwenneth", "Belathil", "Caladwen", "Celestriel", "Cyrwen", "Daenyra", "Eiliriel", "Elaenwe", "Elowyn", "Esmelle", "Faervel", "Filaurel", "Galanthe", "Gwaelin", "Haliviel", "Ilyrana", "Ithildae", "Jarsali", "Kaelwyn", "Lathriel", "Lireth", "Maerwen", "Mythariel", "Nimriel", "Olyssa", "Phaerenne", "Qualathe", "Rilynne", "Saelira", "Sylwen", "Taeryn", "Ysoldael"],
    surnames: ["Amakiir", "Amastacia", "Galanodel", "Holimion", "Ilphelkiir", "Liadon", "Meliamne", "Nailo", "Siannodel", "Xiloscient", "Aloro", "Caerdonel", "Eathalena", "Goltorah", "Hawksong", "Ilizimmer", "Koehlanna", "Mistwalker", "Moonwhisper", "Nightbreeze", "Raulnor", "Silverfrond", "Starflower", "Truesilver", "Vaeren", "Withrender", "Yescalle", "Alderleaf", "Avarenne", "Brightwind", "Caelwynn", "Dawnwhisper", "Duskrunner", "Eveningfall", "Fanolel", "Gemflower", "Glimmerdusk", "Highsong", "Ithilwen", "Leafbower", "Lightfeather", "Moonbrook", "Naerynth", "Nightsilver", "Oakenshade", "Petalstride", "Rainsong", "Silverbough", "Songweaver", "Starweaver", "Sunshadow", "Thistlewind", "Windwhisper", "Wintermoon"]
  },

  // Hard stops, doubled consonants, and clan surnames.
  dwarf: {
    male: ["Adrik", "Alberich", "Baern", "Barendd", "Brottor", "Dain", "Darrak", "Delg", "Eberk", "Einkil", "Fargrim", "Flint", "Gardain", "Harbek", "Kildrak", "Morgran", "Orsik", "Oskar", "Rangrim", "Rurik", "Taklinn", "Thoradin", "Thorin", "Tordek", "Traubon", "Travok", "Ulfgar", "Veit", "Vondal", "Brom", "Durgan", "Korrun", "Norbus", "Skalf", "Throdin", "Bromgar", "Balgrom", "Balrik", "Bofnar", "Borgan", "Brimgar", "Dolgrim", "Dolnar", "Dwalgar", "Ergrim", "Farnak", "Fjorn", "Gimbar", "Grumdal", "Grunbeck", "Haldrek", "Hargrim", "Jarnvid", "Kazrim", "Kholgar", "Krondar", "Lodrik", "Mordak", "Murdrak", "Nordri", "Olgrim", "Ormgar", "Rokdan", "Sindrik", "Snorri", "Thargrim", "Thrand", "Ulfrik", "Urdin", "Vargrim", "Vondrek", "Yngvar"],
    female: ["Amber", "Artin", "Audhild", "Bardryn", "Dagnal", "Diesa", "Eldeth", "Falkrunn", "Finellen", "Gunnloda", "Gurdis", "Helja", "Hlin", "Kathra", "Kristryd", "Ilde", "Liftrasa", "Mardred", "Riswynn", "Sannl", "Torbera", "Torgga", "Vistra", "Aelgifu", "Brunnhild", "Dwalia", "Gerd", "Hilde", "Kira", "Lodda", "Nala", "Ovina", "Sigrun", "Thyra", "Vigdis", "Yurgen", "Astrid", "Belka", "Brynhild", "Dagna", "Drenna", "Eldrun", "Frida", "Gilda", "Gretka", "Gunnhild", "Halgra", "Hjordis", "Ingra", "Jorunn", "Kelda", "Kordis", "Lorra", "Magrid", "Morgrid", "Nordis", "Orla", "Ragna", "Reidun", "Runa", "Sigrid", "Solveig", "Thora", "Tilda", "Ursla", "Valka", "Verna", "Vorda", "Wilda", "Yrsa", "Yrgrid", "Zelda"],
    surnames: ["Balderk", "Battlehammer", "Brawnanvil", "Dankil", "Fireforge", "Frostbeard", "Gorunn", "Holderhek", "Ironfist", "Loderr", "Lutgehr", "Rumnaheim", "Strakeln", "Torunn", "Ungart", "Anvilmar", "Coalhewer", "Deepdelve", "Emberforge", "Goldvein", "Grimblade", "Hammerfall", "Ironhelm", "Karrduum", "Oremantle", "Stonehand", "Thunderbrew", "Undermountain", "Warmaul", "Yundrok", "Axeholt", "Bellowsgrim", "Blackanvil", "Bouldershield", "Braegur", "Cinderhelm", "Copperbraid", "Deepforge", "Drakkenhold", "Flintbeard", "Forgewright", "Gemcutter", "Granitefist", "Grimhelm", "Hearthglow", "Hollowpick", "Ironbrow", "Kegsmasher", "Mithralborn", "Oathanvil", "Quarryborn", "Runecarver", "Sootbeard", "Steelvein", "Stonewarden", "Tunnelguard", "Vaultkeeper", "Warmantle", "Whetstone", "Winterforge"]
  },

  // Homely given names paired with warm, earthy family names.
  halfling: {
    male: ["Alton", "Ander", "Bernie", "Bobbin", "Cade", "Callus", "Corrin", "Dannad", "Danniel", "Eddie", "Egart", "Eldon", "Errich", "Finnan", "Garret", "Gob", "Lindal", "Lyle", "Merric", "Milo", "Mungo", "Nebin", "Osborn", "Ostran", "Perrin", "Pip", "Poppy", "Quentin", "Reed", "Roscoe", "Shardon", "Tye", "Ulmo", "Wellby", "Wendel", "Finch", "Amble", "Barrow", "Bodo", "Bramble", "Cobb", "Cully", "Dabbin", "Dobbs", "Emmet", "Fargo", "Fenno", "Gaffer", "Hamlin", "Hobbin", "Jory", "Kip", "Lark", "Linus", "Mabbit", "Nim", "Odo", "Otho", "Pelly", "Quill", "Rollo", "Rudd", "Sam", "Sprig", "Tobin", "Tulley", "Umbry", "Warin", "Wick", "Willow", "Yarrow", "Zeke"],
    female: ["Andry", "Bree", "Callie", "Cora", "Euphemia", "Gynnie", "Harriet", "Jillian", "Lavinia", "Lidda", "Maegan", "Marigold", "Merla", "Myria", "Nedda", "Nikki", "Nora", "Olivia", "Paela", "Pearl", "Penny", "Portia", "Robbie", "Rose", "Saral", "Seraphina", "Shaena", "Stacee", "Tansy", "Trym", "Vani", "Verna", "Wilow", "Cherry", "Dell", "Petunia", "Amaryllis", "Bess", "Bramblyn", "Clover", "Daisy", "Dimity", "Elda", "Fennel", "Flora", "Gilly", "Hazel", "Holly", "Ivy", "Jemma", "Josie", "Kerry", "Lettie", "Lilac", "Mabel", "Millie", "Nella", "Nutmeg", "Oda", "Peony", "Pippa", "Prilla", "Quilla", "Rilla", "Rue", "Sage", "Sorrel", "Tilly", "Tuppence", "Vetch", "Wren", "Zinnia"],
    surnames: ["Brushgather", "Goodbarrel", "Greenbottle", "Highhill", "Hilltopple", "Leagallow", "Tealeaf", "Thorngage", "Tosscobble", "Underbough", "Appleblossom", "Brambletoe", "Copperkettle", "Dewfoot", "Fairwind", "Greenmeadow", "Honeypot", "Littlefoot", "Mossbarrow", "Nimblefinger", "Oakbottom", "Proudfellow", "Quickstep", "Reedwhistle", "Sweetwater", "Thistledown", "Warmhearth", "Wildbloom", "Wobblefoot", "Yellowknoll", "Applewhistle", "Barleymow", "Bramblebank", "Butterbrook", "Cloverdown", "Cozyhearth", "Crumblecake", "Deepcellar", "Downybank", "Elderberry", "Fernbottom", "Gladhollow", "Goodbarrow", "Hearthkettle", "Hedgerow", "Hollyhock", "Jamjar", "Kettlewick", "Marrowfield", "Mellowmead", "Nettlebrook", "Orchardgate", "Pennyloaf", "Plumworth", "Quietbrook", "Rosemarrow", "Saffronhill", "Tumbleweed", "Wanderfoot", "Wheatbarrow"]
  },

  // Whimsical, busy, often double-syllabled given names; nickname-ish surnames.
  gnome: {
    male: ["Alston", "Alvyn", "Boddynock", "Brocc", "Burgell", "Dimble", "Eldon", "Erky", "Fonkin", "Frug", "Gerbo", "Gimble", "Glim", "Jebeddo", "Kellen", "Namfoodle", "Orryn", "Pock", "Roondar", "Seebo", "Sindri", "Warryn", "Wrenn", "Zaffrab", "Zook", "Bimble", "Cogsly", "Fibblestib", "Gallywix", "Nim", "Sprocket", "Tinder", "Whizzle", "Zibbick", "Quill", "Fenwick", "Bippin", "Boddin", "Brannock", "Cobble", "Dabbledob", "Dimwick", "Fanlo", "Fizzik", "Flimble", "Gandin", "Gimbo", "Glimwick", "Grondle", "Hobble", "Jebbin", "Kribble", "Lorbin", "Mickle", "Nabbin", "Nimbus", "Oglin", "Pallabar", "Pindle", "Quillo", "Rondle", "Snibbet", "Sprig", "Thistle", "Tock", "Tumblin", "Uggle", "Vondle", "Whibble", "Wobbin", "Yondle", "Zimble"],
    female: ["Bimpnottin", "Breena", "Caramip", "Carlin", "Donella", "Duvamil", "Ella", "Ellyjobell", "Ellywick", "Lilli", "Loopmottin", "Lorilla", "Mardnab", "Nissa", "Nyx", "Oda", "Orla", "Roywyn", "Shamil", "Tana", "Waywocket", "Zanna", "Bizzle", "Cogwen", "Fizzwidget", "Glimmer", "Jinx", "Mella", "Niddle", "Pippa", "Quenna", "Sproket", "Tinka", "Whirla", "Zelda", "Zibilna", "Bimblet", "Brindle", "Cobbie", "Dazzle", "Dimple", "Ellabel", "Fizzy", "Flinda", "Gemma", "Gindle", "Glimma", "Grettabel", "Hobbina", "Idabel", "Jibby", "Kinnabel", "Lorabel", "Mippy", "Nibblet", "Nimbella", "Ondelle", "Pennyla", "Pipsy", "Quilla", "Rillabel", "Snibbie", "Sparkle", "Tabby", "Thimbella", "Tinkabel", "Uffie", "Velvet", "Wibblet", "Winnabel", "Yippa", "Zibbet"],
    surnames: ["Beren", "Daergel", "Folkor", "Garrick", "Nackle", "Murnig", "Ningel", "Raulnor", "Scheppen", "Timbers", "Turen", "Camberwick", "Coggspindle", "Copperbottom", "Fiddlewidget", "Gearloose", "Glitterspark", "Greasethumb", "Knappenspring", "Leatherbritches", "Nimblecog", "Quickwrench", "Sparkfizzle", "Steamwhistle", "Tinkertop", "Trinketspring", "Wheezleworth", "Whirligig", "Wobbleknock", "Zappercrank", "Bellowsprocket", "Bobblewrench", "Brasswhistle", "Cinderspring", "Clockmender", "Cogwhistle", "Dazzlespark", "Fiddlecrank", "Flintwhistle", "Gadgetwright", "Gigglegear", "Glimmerwick", "Grindlespark", "Hammerfizz", "Jinglepocket", "Kettlespring", "Lampwhistle", "Nimbletinker", "Oddlewrench", "Pipspanner", "Puttergear", "Quibblecrank", "Rattlewidget", "Sprocketwhistle", "Tangleknot", "Thimblewhirl", "Tockspring", "Widgetbottom", "Windupwick", "Zizzlecog"]
  },

  // Sharp, draconic given names; clan names carried with pride.
  dragonborn: {
    male: ["Arjhan", "Balasar", "Bharash", "Donaar", "Fenkesh", "Garrik", "Ghesh", "Greethen", "Haran", "Heskan", "Jheren", "Kaladan", "Kriv", "Maldrek", "Medrash", "Mehen", "Nadarr", "Narghul", "Orzheth", "Pandjed", "Patrin", "Pharanx", "Rezkel", "Rhogar", "Shamash", "Shedinn", "Suresh", "Tarhun", "Threvik", "Torinn", "Urlax", "Vandren", "Vrakor", "Xornath", "Zarvox", "Zharzul", "Adrex", "Athkar", "Baradun", "Bazrik", "Charrax", "Daarvex", "Drakkan", "Draxen", "Ekreth", "Faskar", "Gorvax", "Hazrek", "Ixthar", "Jarrhek", "Kazrix", "Khoravan", "Krevash", "Lorvath", "Malkash", "Morrax", "Nezzarath", "Ormak", "Pyrrhax", "Qurath", "Rhazak", "Sarrhun", "Skarrath", "Tazrek", "Thorvax", "Ulvrak", "Vaskar", "Vorrax", "Xarran", "Yarrhek", "Zaruk", "Zerrath"],
    female: ["Akra", "Biri", "Daar", "Farideh", "Harann", "Havilar", "Jheri", "Kava", "Korinn", "Mishann", "Nala", "Perra", "Raiann", "Sora", "Surina", "Thava", "Uadjit", "Anaxis", "Bexen", "Chassyth", "Daenara", "Esha", "Halar", "Irithel", "Jorra", "Khoradi", "Lashann", "Myrra", "Nesryn", "Orinda", "Ravara", "Sethra", "Thyrra", "Vezera", "Yrjala", "Zephira", "Ashkara", "Aszira", "Baxara", "Bhelara", "Charrha", "Corrhaza", "Drakara", "Draxara", "Ezzira", "Fharra", "Gorraza", "Haszira", "Ixara", "Jarrhea", "Kazrina", "Khorra", "Krevira", "Lorvira", "Malkara", "Mezzara", "Nazira", "Ormara", "Pyrrha", "Quarra", "Rhazira", "Sarrha", "Skarra", "Tazrina", "Thessra", "Ulvara", "Vaszira", "Vorrha", "Xarrina", "Yarrha", "Zarrina", "Zheshka"],
    surnames: ["Clethtinthiallor", "Daardendrian", "Delmirev", "Drachedandion", "Fenkenkabradon", "Kerrhylon", "Kimbatuul", "Linxakasendalor", "Myastan", "Nemmonis", "Norixius", "Ophinshtalajiir", "Prexijandilin", "Shestendeliath", "Turnuroth", "Verthisathurgiesh", "Yarjerit", "Akthaljasiir", "Belaxus", "Chalandra", "Dracoroth", "Embrethar", "Ghaazenvenk", "Hauthrandar", "Jerynomon", "Kepeshkmolik", "Mordennkel", "Ozzrenkoth", "Velkaroth", "Zoradomir", "Aurxathis", "Balankarion", "Charranthiir", "Drakkanassar", "Elkethryx", "Fharzendrion", "Gorvaxandir", "Haszakthule", "Iskarathien", "Jorvanthiss", "Karnathurgan", "Krevanthaxor", "Lorvaxendal", "Mezzarkanth", "Nemthuraxis", "Orvanthelex", "Pyraxendreth", "Quorathizan", "Rhazakthiir", "Sarrhendrax", "Skarvanthus", "Tazrekandor", "Thessarivax", "Ulvaraxeth", "Vaszakrendil", "Vorrhaxandi", "Xarrenthiss", "Yarrhakanth", "Zarrendrixis", "Zhessakarium"]
  },

  // Infernal given names alongside Common "virtue" names; rarely a family name.
  tiefling: {
    male: ["Akmenos", "Amnon", "Barakas", "Damakos", "Ekemon", "Iados", "Kairon", "Leucis", "Melech", "Mordai", "Morthos", "Pelaios", "Skamos", "Therai", "Antos", "Carrion", "Creed", "Dolor", "Fury", "Grief", "Iratu", "Karn", "Lazarus", "Mammon", "Nerul", "Phistys", "Quennar", "Ronove", "Sorrow", "Tarchon", "Vassago", "Wrath", "Xaphan", "Zagan", "Zephar", "Balor", "Abyzou", "Amduscias", "Anguish", "Astaros", "Barbatos", "Belial", "Caim", "Cathos", "Dantalion", "Devros", "Dread", "Ekaron", "Focalor", "Gaap", "Haures", "Ipos", "Kalos", "Malphas", "Marbas", "Naberis", "Orias", "Paimon", "Peril", "Phenex", "Raum", "Reckoning", "Sabnos", "Seere", "Stolas", "Thamuz", "Torment", "Valefor", "Vengeance", "Vepar", "Volac", "Zepar"],
    female: ["Akta", "Anakis", "Armara", "Astaro", "Bryseis", "Criella", "Damaia", "Decarabia", "Ea", "Kallista", "Lerissa", "Makaria", "Nemeia", "Orianna", "Phelaia", "Rieta", "Faith", "Glory", "Grace", "Hope", "Joy", "Lament", "Mercy", "Misery", "Poetry", "Prosper", "Solace", "Temperance", "Tribulation", "Verity", "Vigil", "Despair", "Ember", "Vesper", "Sorrow", "Mourn", "Abbadia", "Allocera", "Atonement", "Azaria", "Barbatha", "Beleth", "Caimira", "Chastity", "Constance", "Dantala", "Delphia", "Eligora", "Fortune", "Furcasia", "Gremora", "Halphia", "Ipsara", "Kalira", "Lilitha", "Malphia", "Marbasa", "Naberia", "Oriaxa", "Paimira", "Patience", "Phenexa", "Reverie", "Ronova", "Sabnira", "Seerith", "Stolara", "Thamira", "Valefia", "Veparia", "Volaxa", "Zeparia"],
    surnames: []
  },

  // Guttural, blunt given names; descriptive epithet surnames.
  "half-orc": {
    male: ["Dench", "Feng", "Gell", "Henk", "Holg", "Imsh", "Keth", "Krusk", "Mhurren", "Ront", "Shump", "Thokk", "Brakka", "Drogh", "Gorruk", "Harsk", "Jorgu", "Kruth", "Lurg", "Morto", "Narek", "Ogrash", "Ruthak", "Skarn", "Thuldar", "Ugrek", "Vorgan", "Warl", "Yazgash", "Zoruk", "Bregg", "Durth", "Grakk", "Murzol", "Snagg", "Throk", "Arnok", "Bakk", "Borgak", "Charrg", "Dragh", "Dulk", "Elgor", "Fazuk", "Garruk", "Gnarth", "Grukk", "Hargul", "Hozzk", "Jorak", "Karg", "Korthul", "Kruggan", "Lurruk", "Maggok", "Morgak", "Nurrik", "Ogan", "Orbak", "Prakk", "Rakkul", "Rugar", "Skath", "Sorgh", "Tarruk", "Thagar", "Ugoth", "Urrak", "Vashk", "Vorgg", "Yurzuk", "Zagor"],
    female: ["Baggi", "Emen", "Engong", "Kansif", "Myev", "Neega", "Ovak", "Ownka", "Shautha", "Sutha", "Vola", "Yevelda", "Arna", "Brugha", "Creesha", "Dasha", "Greshka", "Hagga", "Iskra", "Krusha", "Lorga", "Murook", "Nazka", "Orvga", "Ruka", "Sharna", "Throga", "Ulga", "Veshka", "Wugga", "Yarka", "Zerga", "Drelka", "Gorsha", "Murza", "Brakla", "Ashgra", "Braka", "Bruska", "Corga", "Dragga", "Durkha", "Elgha", "Frazka", "Garnka", "Ghorra", "Grukka", "Hazga", "Ilka", "Jorra", "Kagga", "Korzha", "Krunna", "Lurka", "Maggra", "Morzha", "Nurka", "Ogga", "Orbka", "Prakka", "Rakka", "Rugza", "Skatha", "Sorgha", "Tarka", "Thagra", "Ugga", "Urzha", "Vashka", "Vorgga", "Yurza", "Zagra"],
    surnames: ["Bonebreaker", "Doomhowl", "Ironhide", "Skullcleaver", "Bloodfang", "Grimtusk", "Axebiter", "Bloodmaw", "Earthsplitter", "Foecrusher", "Gravelfist", "Hardskull", "Ironjaw", "Marrowtaker", "Nightreaver", "Ragehowl", "Scarback", "Skullsplitter", "Spinecrack", "Thornhide", "Warbringer", "Wolfsbane", "Wrathborn", "Bonechewer", "Anvilbreaker", "Battlescar", "Blackfang", "Bloodhowl", "Bonecarver", "Brutefist", "Cragfist", "Deathgrin", "Dustmaw", "Fellhide", "Grimhowl", "Harrowfang", "Ironmarrow", "Ironmaw", "Jawbreaker", "Longtusk", "Oathbiter", "Ramhorn", "Scarjaw", "Skullmarked", "Stonefist", "Tuskbreaker", "Warhide", "Wolfhowl"]
  },

  // Full-orc voice — harsher than half-orc, clan/warband bynames.
  orc: {
    male: ["Drogan", "Garg", "Grom", "Karash", "Korga", "Lubash", "Morg", "Tharag", "Ugar", "Vrakk", "Zogthar", "Brughol", "Durz", "Gorthak", "Hrolf", "Karruk", "Lokar", "Maugh", "Nargol", "Orruk", "Rensh", "Shagrol", "Thurok", "Uthak", "Vorgun", "Zharkk", "Brokk", "Dremor", "Gashnak", "Hruth", "Kruul", "Margash", "Nokk", "Rugor", "Skarth", "Thokkar", "Azgar", "Bhorak", "Brughast", "Bruzgor", "Dagruk", "Dorgul", "Dreshk", "Fangor", "Gharrak", "Ghorak", "Gnarruk", "Grulmar", "Hakkul", "Hrogar", "Jurgak", "Kagrul", "Kholrak", "Krugmar", "Lorgash", "Maghrul", "Morbak", "Nurghak", "Orgul", "Rakthar", "Rhogash", "Skulgar", "Snargor", "Tarkul", "Thragar", "Ugmar", "Urghal", "Vashgar", "Vrogash", "Yagruk", "Zharok", "Ogrim"],
    female: ["Creng", "Engong", "Greshka", "Murook", "Nagra", "Orla", "Shagra", "Ubag", "Vola", "Zenka", "Brughda", "Drazka", "Garsha", "Hrenna", "Kruska", "Lurgha", "Mogra", "Nazgha", "Orvka", "Reshka", "Shauka", "Thargha", "Ulka", "Vrenda", "Yorga", "Zhurka", "Brakta", "Dushka", "Gnasha", "Harsha", "Krenda", "Morgda", "Naksha", "Ronka", "Skarna", "Thugra", "Azgra", "Bhorka", "Brugza", "Bruzga", "Dagra", "Dorgla", "Dreshka", "Fangra", "Gharrka", "Ghorka", "Gnarra", "Grulma", "Hakka", "Hrogza", "Jurgha", "Kagrula", "Kholra", "Krugma", "Lorgza", "Maghra", "Morbka", "Nurgha", "Ogrza", "Orgula", "Rakhta", "Rhogza", "Skulga", "Snargha", "Tarkha", "Thragra", "Ugmara", "Urghla", "Vashgra", "Vrogza", "Yagra", "Zharka"],
    surnames: ["Skullsplitter", "Eyegouger", "Throatripper", "Foecrusher", "Bloodmaw", "Bonegrinder", "Deathmaw", "Facebreaker", "Gutripper", "Headtaker", "Ironhowl", "Manslayer", "Necksnapper", "Ragefang", "Skinflayer", "Spinebreaker", "Tuskgore", "Warmonger", "Wrathmaw", "Doomfist", "Gloomtusk", "Hatecleaver", "Redhand", "Sundermaw", "Ashfang", "Battlemaw", "Bonespike", "Charskull", "Dreadtusk", "Fleshrender", "Gorehowl", "Grimjaw", "Hidereaver", "Ironfang", "Killtooth", "Maimhand", "Marrowgnash", "Nightfang", "Rendclaw", "Ruinmaw", "Scarhide", "Skullthrone", "Slaughterhorn", "Stonemaw", "Throatgnasher", "Tuskrender", "Warhowl", "Wrathtusk"]
  },

  // A human-elf blend: graceful given names with grounded surnames.
  "half-elf": {
    male: ["Aramil", "Berrin", "Caelum", "Corwin", "Daeris", "Elwin", "Erevan", "Faelyn", "Galen", "Hadrian", "Ilian", "Joram", "Kael", "Lucan", "Maelon", "Naeris", "Orrin", "Quentin", "Riardon", "Soren", "Theron", "Ulric", "Varian", "Wystan", "Aelric", "Berevan", "Cedric", "Daelan", "Evrin", "Galeth", "Halvar", "Joren", "Kaelis", "Lyran", "Maric", "Veyric", "Aedan", "Alrik", "Arannis", "Baelric", "Caladan", "Corin", "Daeron", "Delric", "Edan", "Elwyn", "Erlan", "Fael", "Galwyn", "Gethin", "Harlan", "Ilric", "Jorvan", "Kelric", "Laelan", "Loren", "Maelric", "Neriel", "Orian", "Perrian", "Quillan", "Raelan", "Rhysan", "Selwyn", "Taelon", "Tirion", "Ulyn", "Vaelric", "Vandar", "Wrenlan", "Yarel", "Zerrin"],
    female: ["Anya", "Aravae", "Brisa", "Caelia", "Dara", "Elenwe", "Elaria", "Faela", "Genna", "Iliana", "Jessa", "Kira", "Lera", "Liriel", "Mara", "Naia", "Nessa", "Oriel", "Rowena", "Sariel", "Selene", "Thessaly", "Una", "Vaela", "Wenna", "Yssa", "Aeris", "Briala", "Caelynn", "Delwyn", "Elara", "Faylen", "Iridia", "Lyssa", "Maelis", "Saelra", "Aelwen", "Alasse", "Arienne", "Aviel", "Belwyn", "Brinnwen", "Caladra", "Corienne", "Daenna", "Elunna", "Emeris", "Erwyn", "Faelwen", "Galenna", "Halwen", "Iriell", "Jorwyn", "Kaelwen", "Lianna", "Loreth", "Maelwen", "Neriell", "Orienne", "Perrienne", "Quillienne", "Raella", "Rhysanne", "Selwenna", "Taelenne", "Tirianne", "Ulyssa", "Vaelienne", "Vandra", "Wrenna", "Yarelle", "Zerrienne"],
    surnames: ["Amblecrown", "Galanodel", "Holborn", "Meliamne", "Sunbright", "Thornbury", "Windrivven", "Ashvale", "Brightwood", "Cearshade", "Dawngrove", "Embermoor", "Fallowmere", "Greenmantle", "Halfmoon", "Ivorel", "Larkmoor", "Mistral", "Nightdew", "Oakenshield", "Palebrook", "Quillsong", "Ravenshade", "Silverbrook", "Starfall", "Thornwell", "Underleaf", "Vaelora", "Whitethorn", "Wyndmere", "Ashenvale", "Bellwater", "Brightmere", "Cindermoor", "Dawnhollow", "Duskvale", "Eveningbrook", "Fairholme", "Glasswater", "Greyleaf", "Hallowbrook", "Highgrove", "Ivyholt", "Lanternwood", "Lightbourne", "Moonbarrow", "Northwind", "Oakenmere", "Pearlbrook", "Quietgrove", "Rainholt", "Silverhollow", "Springmere", "Starbrook", "Summerfall", "Thistlemere", "Vinehollow", "Westerly", "Willowbrook", "Wintervale"]
  },

  // Celestial given names; luminous bynames.
  aasimar: {
    male: ["Cassiel", "Eliad", "Heshem", "Joren", "Micah", "Oziel", "Raphael", "Sariel", "Tariel", "Zaphkiel", "Adriel", "Barachiel", "Camael", "Dumiel", "Ezriel", "Gabriah", "Hadriel", "Israfel", "Jophiel", "Kemuel", "Lucael", "Muriel", "Nathaniel", "Oriel", "Pravuil", "Remiel", "Suriel", "Theliel", "Uriel", "Vehuel", "Yeriel", "Zachriel", "Anael", "Castiel", "Phanuel", "Selaphiel", "Abariel", "Amariel", "Amriel", "Ariel", "Asariel", "Baruchiel", "Chamuel", "Dariel", "Elamiel", "Ezekiah", "Gadriel", "Hamaliel", "Haniel", "Ithuriel", "Jeduthun", "Kadriel", "Laviel", "Malachiel", "Meliel", "Nathriel", "Ohaniel", "Ophaniel", "Perael", "Qadriel", "Rachiel", "Sandalphon", "Seraphiel", "Simiel", "Tabriel", "Theodriel", "Uzziel", "Valiel", "Verchiel", "Yahoel", "Zadkiel", "Zeruel"],
    female: ["Aurelia", "Celesta", "Elysia", "Halcyon", "Liora", "Nethys", "Seraphine", "Sorath", "Vesper", "Zariel", "Amariah", "Beriah", "Cassia", "Donatha", "Elurael", "Galadriah", "Hosanna", "Ilora", "Jubilee", "Kerasel", "Luciel", "Mireille", "Nuriel", "Oriphel", "Pelagia", "Quietha", "Raziela", "Sephira", "Tamariel", "Uriela", "Valoria", "Yaeliel", "Anjelica", "Damariel", "Solenne", "Verael", "Abriela", "Adriela", "Ambriela", "Anathiel", "Arieth", "Auriela", "Beliela", "Caeliel", "Chamuela", "Dariela", "Elariel", "Evangeline", "Gabriela", "Haniela", "Ithuriela", "Jeriel", "Kadriela", "Lucielle", "Malachia", "Meliora", "Nathriela", "Ophelia", "Peraela", "Qadriela", "Rachiela", "Sarael", "Seraphia", "Simiela", "Tabriela", "Theodora", "Uzziela", "Valiela", "Verchiela", "Yahoela", "Zadkiela", "Zeruela"],
    surnames: ["Dawnbringer", "Lightbearer", "Skyborn", "Hallowmere", "Auremon", "Brightveil", "Celestar", "Dawnward", "Emberhalo", "Goldenmere", "Halewing", "Hopebringer", "Lightward", "Lumenis", "Morningvale", "Nimbright", "Oathkeeper", "Pureheart", "Radiantmoor", "Solhaven", "Starborne", "Sunhallow", "Truelight", "Vesperdawn", "Whitehalo", "Auriel", "Beaconmoor", "Gracewind", "Lightspire", "Sanctus", "Auroreach", "Blessedvale", "Brightmantle", "Candlemere", "Cloudsinger", "Dawnhallow", "Dayspring", "Everlight", "Firmament", "Glorymark", "Haloheart", "Havenlight", "Highhallow", "Holyfield", "Lampbearer", "Lightweaver", "Meridiem", "Morningstar", "Nimbusfall", "Praisesong", "Radiantwing", "Sanctumveil", "Seraphmoor", "Silverhalo", "Skysong", "Solarium", "Sunwarden", "Vigilheart", "Wingborne", "Zenithmoor"]
  },

  // Birth name plus a clan name plus a self-chosen nickname feel; we use clan surnames.
  goliath: {
    male: ["Aukan", "Eglath", "Gae-Al", "Kavaki", "Lo-Kag", "Manneo", "Pao-Vek", "Thalai", "Vaunea", "Keothi", "Aukana", "Eglan", "Gauthak", "Ilikan", "Kaethal", "Lotharn", "Maveith", "Nalothi", "Oragh", "Paval", "Rauthi", "Skanar", "Tharos", "Uthal", "Vethan", "Aekan", "Brakan", "Dethan", "Gantar", "Harthal", "Kethran", "Lavak", "Methos", "Oranthi", "Ravan", "Thelan", "Aelthar", "Arakan", "Bethok", "Braketh", "Dagath", "Dothakan", "Ekathi", "Farokan", "Gavuth", "Gerothi", "Grathok", "Hakathan", "Hulathi", "Ilothar", "Jorakan", "Kaethok", "Korathi", "Lathokan", "Makath", "Melothar", "Nemothar", "Norakan", "Olathok", "Pethari", "Ravathi", "Rethokan", "Sarothi", "Skathok", "Tavakan", "Thelokath", "Ulathok", "Uvathi", "Vanokan", "Vethokan", "Yaruthi", "Zathokan"],
    female: ["Aleitha", "Brunhilde", "Caelkna", "Gae-Akh", "Kuori", "Manea", "Nalla", "Orilo", "Thestraki", "Vaelra", "Aukea", "Dolatha", "Elathi", "Gauthi", "Ilethka", "Kavari", "Lonatha", "Marketh", "Nethaki", "Oraka", "Ravetha", "Sethari", "Thalka", "Uvitha", "Vaketha", "Aenka", "Brethi", "Daketha", "Gunhilda", "Hethari", "Karuna", "Methari", "Oletha", "Selka", "Thraketha", "Ulitha", "Aelketha", "Arakna", "Bethoka", "Braketha", "Dagatha", "Dothakna", "Ekathina", "Farokna", "Gavutha", "Gerothia", "Grathoka", "Hakathana", "Hulathia", "Ilotha", "Joraka", "Kaethoka", "Korathina", "Lathokna", "Makatha", "Melotharia", "Nemotha", "Norakna", "Olathoka", "Petharia", "Ravathina", "Rethokna", "Sarothia", "Skathoka", "Tavakna", "Thelokatha", "Ulathoka", "Uvathia", "Vanokna", "Vethokna", "Yaruthia", "Zathokna"],
    surnames: ["Anakalathai", "Elanithino", "Gathakanathi", "Kalagiano", "Thuliaga", "Vaakindi", "Aeltheath", "Brakanthal", "Gauthrakka", "Ilimaratha", "Kethanaki", "Lothakana", "Maventhio", "Nalagathra", "Oranthela", "Ravanthaki", "Skagathari", "Thelakanos", "Uvithakal", "Vethanaria", "Aukanthio", "Daravethka", "Korathagal", "Tharanikos", "Aelthakoro", "Arakanthil", "Bethokarra", "Dagathimor", "Ekathinaro", "Farokanthi", "Gavuthalor", "Grathokani", "Hulathiaro", "Ilotharakk", "Jorakanthu", "Kaethokari", "Korathimor", "Lathoknara", "Makathirro", "Nemotharak", "Olathokira", "Pethariaro", "Ravathikor", "Sarothimak", "Skathokaro", "Thelokarri", "Vanokathir", "Zathoknaro"]
  },

  // Feline, lilting names; a single name, no surname.
  tabaxi: {
    male: ["Cloud on the Mountaintop", "Five Timber", "Jade Shoe", "Left-Handed Hummingbird", "Smoking Mirror", "Sand Strider", "Quick Claw", "Whisper Wind", "Black Tongue", "Dusk Runner", "Flint Eye", "Grey Pelt", "Hidden Moon", "Iron Whisker", "Long Shadow", "Night Prowler", "Painted Tail", "River Stone", "Silent Pounce", "Storm Whisker", "Tall Grass", "Two Moons", "Wandering Star", "Yellow Fang", "Bright Copper", "Circling Hawk", "Cracked Ivory", "Distant Thunder", "Dry Season", "Echo of Bells", "Fallen Feather", "First Frost", "Green Water", "Half Moon", "Hunting Star", "Lean Reed", "Lost Arrow", "Low Tide", "Mottled Fur", "Nine Steps", "Pale Ember", "Red Clay", "Rolling Stone", "Salt on the Wind", "Seven Rivers", "Sharp Thorn", "Sleeping Drum", "Wide Horizon"],
    female: ["Dancing in Storms", "Gentle Rain", "Morning Mist", "Skirts the Ash", "Two Dry Cloaks", "Quiet Step", "Bright Star", "Soft Paw", "Amber Eyes", "Autumn Leaf", "Curled Tail", "Dawn Whisker", "Ember Glow", "Falling Petal", "Golden Dusk", "Hollow Reed", "Lily Pad", "Moonlit Pool", "Pale Feather", "Singing Brook", "Sleek Shadow", "Velvet Night", "Whispering Sand", "Willow Bend", "Amber Rain", "Bending Grass", "Blue Smoke", "Braided River", "Calling Bird", "Clear Spring", "Cloud Shadow", "Dawn Thistle", "Drifting Seed", "Evening Bell", "First Light", "Glass Beads", "Honey Reed", "Laughing Water", "Little Flame", "Moth Wing", "Open Sky", "Painted Sand", "Quiet Thunder", "Rippling Fur", "Seven Stars", "Silver Thread", "Warm Stone", "White Blossom"],
    surnames: []
  },

  // Goblin / goblinoid — clipped, snarling given names.
  goblinoid: {
    male: ["Drubbus", "Frik", "Gnar", "Hruggek", "Mubo", "Nizz", "Rikk", "Skib", "Thru", "Zibba", "Brak", "Dagnot", "Fizzik", "Gribbit", "Hokk", "Jukk", "Krak", "Liznok", "Murg", "Nakk", "Pogg", "Rasp", "Snikt", "Trog", "Urzz", "Vigg", "Wrenk", "Yark", "Zogg", "Mez", "Bazz", "Chukk", "Dregg", "Fnarg", "Gizz", "Glub", "Grebb", "Hakk", "Igg", "Jibb", "Klugg", "Kritt", "Lurg", "Mogg", "Nugg", "Obb", "Prigg", "Quizz", "Rukk", "Scabb", "Skreeg", "Snagg", "Spligg", "Thugg", "Trikk", "Urgg", "Vazz", "Wugg", "Yazz", "Zrekk"],
    female: ["Brakka", "Eega", "Gritz", "Lhupo", "Meeza", "Nokk", "Riza", "Snik", "Vrek", "Yibba", "Azka", "Crinn", "Drez", "Fenn", "Gixx", "Hessa", "Jizz", "Krik", "Lirra", "Mizka", "Nirr", "Pska", "Qurr", "Resk", "Skritt", "Tezz", "Uzga", "Vixx", "Wibb", "Zira", "Bilka", "Chikka", "Dregga", "Fnizz", "Gikka", "Glubba", "Grebza", "Hakka", "Ikka", "Jibba", "Klugga", "Kritta", "Lurga", "Mogga", "Nugga", "Obba", "Prigga", "Quizza", "Rukka", "Scabba", "Skreega", "Snagga", "Spligga", "Thugga", "Trikka", "Urgga", "Vazza", "Wugga", "Yazza", "Zrekka"],
    surnames: []
  },

  // Kobold — yippy, draconic-diminutive names; tribe bynames.
  kobold: {
    male: ["Gax", "Irhtos", "Kib", "Molik", "Pextlitz", "Sniss", "Tikk", "Urkek", "Vendril", "Zix", "Dax", "Ekess", "Girt", "Hix", "Jakko", "Kobo", "Lirk", "Meeko", "Nibs", "Orik", "Pik", "Quix", "Rasp", "Skitt", "Tazz", "Vex", "Wirt", "Yip", "Zev", "Snik", "Azzik", "Bikk", "Blikk", "Chirt", "Drazz", "Dribbik", "Ekk", "Fizzik", "Grik", "Grimmik", "Hessk", "Ikkit", "Jirt", "Kessik", "Likk", "Mirtik", "Nizz", "Ossik", "Pikk", "Quessik", "Rikkit", "Sessik", "Snikkit", "Tirrik", "Urrik", "Vikk", "Wessik", "Xirt", "Yikk", "Zirrik"],
    female: ["Ekka", "Frix", "Girka", "Hesski", "Iki", "Jezz", "Kitik", "Lissa", "Meri", "Nima", "Orla", "Prix", "Quik", "Rikka", "Sevri", "Tazzi", "Urka", "Vrenna", "Wixa", "Yera", "Zissa", "Bixx", "Drika", "Fessi", "Klikka", "Nessi", "Pikka", "Skirra", "Tikka", "Zerra", "Azzira", "Bikka", "Blikka", "Chirra", "Drazza", "Dribba", "Ekkra", "Fizza", "Grikka", "Grimma", "Hessira", "Ikkra", "Jirra", "Kessa", "Likka", "Mirta", "Nizza", "Ossa", "Pirra", "Quessa", "Rikkita", "Sessa", "Snikka", "Tirra", "Urra", "Vikka", "Wessa", "Xirra", "Yikka", "Zirra"],
    surnames: ["Deepscale", "Gravelclaw", "Mudwing", "Stonetooth", "Ashscale", "Cinderclaw", "Dampcave", "Emberwing", "Flintscale", "Gloomtail", "Rockbiter", "Tunneltooth", "Bonecrack", "Cavegleam", "Dustwing", "Firetail", "Grimescale", "Hoardkeeper", "Lampeye", "Pebbleclaw", "Sandscale", "Trapsetter", "Warrenborn", "Wyrmling"]
  },

  // Lizardfolk — descriptive Draconic names; no surname.
  lizardfolk: {
    male: ["Aryte", "Baeshra", "Garurt", "Irhtos", "Kepesk", "Othok", "Sauriv", "Tarjak", "Usk", "Valnan", "Drathiss", "Eshkek", "Gholar", "Hessk", "Issar", "Korakk", "Maruk", "Nessuk", "Orruk", "Perrok", "Quetz", "Razak", "Sythar", "Tsekk", "Uthar", "Veskar", "Wyrok", "Xathar", "Yssir", "Zharak", "Asrak", "Bathek", "Brakthek", "Chassk", "Drakh", "Drossik", "Esskar", "Ghorak", "Grethkar", "Hesskar", "Ithek", "Jasska", "Kessuk", "Lorrak", "Masska", "Nakthus", "Nethrak", "Ossuk", "Praskar", "Qethek", "Rassuk", "Sethkar", "Sszarok", "Tharrak", "Ussek", "Vrassk", "Wethek", "Xassuk", "Yerrak", "Zhassk"],
    female: ["Achuak", "Emolo", "Irkan", "Kethsk", "Olothk", "Sessih", "Thakka", "Uthkar", "Vesh", "Wakanu", "Asha", "Brekka", "Drassa", "Eshka", "Ghessa", "Hessith", "Issuk", "Karassa", "Lessith", "Massuk", "Nethka", "Orrissa", "Ressuk", "Sythara", "Tassuk", "Vessith", "Wessuk", "Yssara", "Zessa", "Krethka", "Assira", "Bathka", "Brakthra", "Chassa", "Drakha", "Drossa", "Esska", "Ghorra", "Grethka", "Hesska", "Ithka", "Jassira", "Kessa", "Lorra", "Massa", "Nakthra", "Nethra", "Ossa", "Prassa", "Qethka", "Rassa", "Sethka", "Sszara", "Tharra", "Ussa", "Vrassa", "Wethka", "Xassa", "Yerra", "Zhassa"],
    surnames: []
  },

  // Genasi — names echo their elemental heritage; sweeping bynames.
  genasi: {
    male: ["Cinder", "Ash", "Basalt", "Blaze", "Brook", "Cliff", "Coal", "Cyclone", "Drift", "Ember", "Flint", "Gale", "Geyser", "Granite", "Gust", "Magma", "Mistral", "Onyx", "Pyre", "Quartz", "Rime", "Scorch", "Sirocco", "Slate", "Surge", "Talus", "Tempest", "Torrent", "Vapor", "Zephyr", "Avalanche", "Blister", "Cascade", "Char", "Cirrus", "Crag", "Delta", "Dune", "Eddy", "Flare", "Fume", "Glacier", "Hail", "Kindle", "Lava", "Loam", "Monsoon", "Obsidian", "Pumice", "Quarry", "Rapids", "Ridge", "Sandstorm", "Shale", "Squall", "Thunder", "Undertow", "Updraft", "Whirl", "Zenith"],
    female: ["Aria", "Aurora", "Brisa", "Calida", "Cinder", "Coral", "Ember", "Flara", "Gaila", "Ignia", "Lumen", "Marina", "Mistral", "Nixie", "Pyra", "Ondine", "Quilla", "Rilla", "Saffira", "Seren", "Sirena", "Talia", "Tempest", "Terra", "Undine", "Vesta", "Vela", "Zephyra", "Zaira", "Mira", "Aura", "Breeze", "Citrine", "Cumula", "Dewa", "Eddra", "Fathom", "Fjella", "Geode", "Glisten", "Halcyone", "Ignea", "Jetta", "Lagoon", "Lumina", "Mica", "Monsoona", "Nimbra", "Opaline", "Pearla", "Quenia", "Riptide", "Sable", "Scoria", "Sirocca", "Tidea", "Umbra", "Verdia", "Wisp", "Zerine"],
    surnames: ["Emberkin", "Stormborn", "Deepcurrent", "Stonehollow", "Ashwind", "Cinderborn", "Dustwalker", "Flamekin", "Stillwater", "Tidewrack", "Windrider", "Cragheart", "Breathweaver", "Cindersworn", "Cragbound", "Deepborn", "Dustmantle", "Emberwake", "Gustwalker", "Ironvein", "Skyveil", "Stormcaller", "Tidewalker", "Wavecrest"]
  },

  // Warforged — chosen designations, often a single descriptive name.
  warforged: {
    male: ["Anvil", "Bastion", "Cinder", "Forge", "Hammer", "Iron", "Keystone", "Lock", "Mark", "Vault", "Bolt", "Brass", "Bulwark", "Cog", "Cordon", "Crucible", "Ember", "Flint", "Gauge", "Girder", "Lattice", "Ledger", "Mortar", "Onyx", "Piston", "Rivet", "Sentinel", "Spanner", "Tally", "Temper", "Arbor", "Ballast", "Beacon", "Bellows", "Buckle", "Capstone", "Chisel", "Clasp", "Compass", "Dovetail", "Fathom", "Filament", "Gantry", "Harrow", "Hasp", "Ingot", "Junction", "Keel", "Lintel", "Lodestone", "Mainspring", "Pillar", "Plumb", "Quench", "Ratchet", "Reliquary", "Sable", "Scaffold", "Tinder", "Trestle"],
    female: ["Anvil", "Bastion", "Cinder", "Forge", "Hammer", "Iron", "Keystone", "Lock", "Mark", "Vault", "Bolt", "Brass", "Bulwark", "Cog", "Cordon", "Crucible", "Ember", "Flint", "Gauge", "Girder", "Lattice", "Ledger", "Mortar", "Onyx", "Piston", "Rivet", "Sentinel", "Spanner", "Tally", "Temper", "Arbor", "Ballast", "Beacon", "Bellows", "Buckle", "Capstone", "Chisel", "Clasp", "Compass", "Dovetail", "Fathom", "Filament", "Gantry", "Harrow", "Hasp", "Ingot", "Junction", "Keel", "Lintel", "Lodestone", "Mainspring", "Pillar", "Plumb", "Quench", "Ratchet", "Reliquary", "Sable", "Scaffold", "Tinder", "Trestle"],
    surnames: []
  },

  // --- Eberron ---

  // Changeling — short, fluid personas adopted and discarded at will; no fixed surname.
  changeling: {
    male: ["Bin", "Cas", "Dell", "Esk", "Fane", "Gix", "Harl", "Ix", "Jary", "Kell", "Lun", "Mer", "Nix", "Oth", "Pell", "Quor", "Rix", "Sed", "Tane", "Urm", "Ves", "Wix", "Yarn", "Zel", "Bram", "Dro", "Fenn", "Gisk", "Holt", "Marn", "Alm", "Brix", "Cael", "Coll", "Corm", "Dax", "Drem", "Eld", "Fal", "Grey", "Hale", "Ives", "Jex", "Ker", "Lom", "Mab", "Nym", "Obb", "Pax", "Quen", "Rhen", "Sel", "Tam", "Thal", "Ulf", "Vane", "Wex", "Xan", "Yev", "Zar"],
    female: ["Ana", "Brie", "Cyn", "Dris", "Esi", "Fay", "Gwel", "Hesh", "Isa", "Jyn", "Kira", "Liss", "Mira", "Nels", "Oona", "Pril", "Quill", "Risa", "Sable", "Tace", "Une", "Vesp", "Wyn", "Yara", "Zin", "Bex", "Dova", "Esme", "Lenna", "Lune", "Ailis", "Bree", "Bry", "Cass", "Cira", "Dree", "Elle", "Fen", "Gale", "Halle", "Ivy", "Jess", "Kyre", "Lark", "Maeve", "Nell", "Nyla", "Orla", "Pia", "Quin", "Rue", "Saffi", "Sylph", "Tess", "Uma", "Vell", "Wisp", "Xena", "Yenn", "Zara"],
    surnames: []
  },

  // Shifter — grounded, bestial given names; descriptive pack epithets.
  shifter: {
    male: ["Bram", "Coll", "Drev", "Eron", "Fenn", "Grix", "Harn", "Jarl", "Kesh", "Lash", "Morr", "Nash", "Orin", "Pell", "Rurik", "Skar", "Torv", "Varn", "Wulf", "Yorn", "Brak", "Cael", "Dunn", "Greth", "Hollow", "Krev", "Lurn", "Roak", "Sten", "Vesk", "Arn", "Bane", "Brenn", "Corrick", "Dax", "Drenn", "Egan", "Fang", "Garr", "Grell", "Hark", "Jax", "Kellan", "Korr", "Lorn", "Mace", "Naral", "Orrick", "Pike", "Quen", "Rhogan", "Scar", "Sorn", "Tark", "Thom", "Urse", "Vann", "Warg", "Yarn", "Zeke"],
    female: ["Asha", "Bril", "Cova", "Dell", "Esha", "Fenna", "Gwyn", "Hesta", "Isen", "Jora", "Kessa", "Lira", "Mura", "Nessa", "Ona", "Pell", "Resa", "Sava", "Tova", "Una", "Vesh", "Wren", "Yara", "Brisa", "Dova", "Eska", "Fenra", "Lyssa", "Mira", "Senna", "Ailen", "Brenna", "Bryn", "Cass", "Della", "Deri", "Elka", "Fenn", "Grella", "Harla", "Ivet", "Jenna", "Kerra", "Lorna", "Maera", "Marrow", "Nerra", "Ondra", "Perra", "Quilla", "Rhea", "Sable", "Sorrel", "Tarra", "Thessa", "Ursa", "Vella", "Wenna", "Yenna", "Zora"],
    surnames: ["Longstride", "Sharptooth", "Swiftclaw", "Nightnose", "Ironpelt", "Quickfang", "Bramblehide", "Keeneye", "Wildmane", "Greyfur", "Strongback", "Lowtrack", "Boldtrack", "Duskrunner", "Fleetfoot", "Gloomhowl", "Moonchase", "Redclaw", "Sharpscent", "Stormhide", "Thornpelt", "Truescent", "Windmane", "Winterpelt"]
  },

  // Kalashtar — flowing compound names echoing a bonded quori spirit; a single name, no surname.
  kalashtar: {
    male: ["Adamar", "Belavar", "Coratash", "Davandi", "Elathan", "Falavar", "Halamaly", "Indri", "Jolarah", "Kalavash", "Lavandri", "Maravar", "Nevashi", "Oradan", "Pavandri", "Quoralan", "Ravashai", "Solavar", "Talavash", "Uradan", "Velandri", "Wovashai", "Yolaran", "Avantash", "Belaran", "Coravash", "Dolandri", "Elavash", "Halandri", "Ovaran", "Adavashi", "Alavash", "Belorath", "Chandavi", "Chelorath", "Dalashar", "Devandri", "Eravash", "Falandi", "Gholavar", "Halorath", "Iravashi", "Jalandar", "Kavorash", "Lalavash", "Melavash", "Meravan", "Nolandri", "Oravash", "Palorath", "Quovandi", "Ralavash", "Sevandri", "Sholandri", "Talorash", "Ulavandi", "Vorashai", "Welandri", "Yavorash", "Zalandri"],
    female: ["Adari", "Belashai", "Coravi", "Davari", "Elavi", "Falashai", "Halaly", "Indravi", "Jolashai", "Kalavi", "Lavashai", "Maravi", "Nevari", "Oravi", "Pavashai", "Quoravi", "Ravari", "Solashai", "Talavi", "Uravi", "Velashai", "Wovari", "Yolavi", "Avari", "Belavi", "Coravari", "Dolashai", "Elari", "Halavi", "Ovashai", "Adavi", "Alavi", "Belora", "Chandari", "Chelora", "Dalashai", "Devandi", "Eravi", "Falari", "Gholavi", "Halora", "Iravi", "Jalandi", "Kavori", "Lalavi", "Melavi", "Merava", "Nolandi", "Oravashi", "Palora", "Quovari", "Ralavi", "Sevandi", "Sholandi", "Talora", "Ulavari", "Vorashi", "Welandi", "Yavori", "Zalandi"],
    surnames: []
  },

  // --- Ravenloft lineages ---

  // Dhampir — gothic, aristocratic given names; old Barovian house names.
  dhampir: {
    male: ["Aleksandr", "Anton", "Casimir", "Dmitri", "Emeric", "Florian", "Gavril", "Henrik", "Ivar", "Janos", "Kristoff", "Lucian", "Mircea", "Nikolai", "Ordin", "Petru", "Radu", "Sorin", "Tobias", "Ulric", "Vasile", "Wilhelm", "Yorick", "Aldric", "Bogdan", "Drazen", "Mihail", "Stefan", "Tomas", "Viktor", "Adrian", "Alexei", "Boris", "Constantin", "Corvin", "Danyl", "Dragomir", "Eduard", "Emil", "Feodor", "Grigori", "Horatiu", "Iancu", "Josef", "Karol", "Laszlo", "Lazar", "Marku", "Milosh", "Nicodem", "Octavian", "Pavel", "Rasko", "Sandor", "Sebastian", "Silviu", "Teodor", "Valerian", "Vlad", "Zoltan"],
    female: ["Anica", "Carmilla", "Doina", "Elena", "Floriana", "Greta", "Ileana", "Jelena", "Katarina", "Ludmila", "Marishka", "Nadia", "Ottilie", "Petra", "Rozalia", "Sasha", "Tatyana", "Ursula", "Vasilica", "Wanda", "Yelena", "Anya", "Dragana", "Elise", "Mina", "Sabina", "Vesna", "Zora", "Liesl", "Mirela", "Adriana", "Alina", "Bogdana", "Corina", "Cosmina", "Daciana", "Draga", "Dragica", "Eleonora", "Filipa", "Gabriela", "Hedda", "Ilinca", "Irinia", "Jovanka", "Kristina", "Lenora", "Magda", "Milena", "Natalya", "Oksana", "Paraschiva", "Radmila", "Simona", "Sorina", "Teodora", "Valeria", "Viorica", "Yvanna", "Zlata"],
    surnames: ["Dragovich", "Marek", "Lazarescu", "Stoyan", "Petrov", "Vadoma", "Radek", "Novak", "Vasiliev", "Mirov", "Cantemir", "Dalca", "Grigore", "Iliescu", "Karnstein", "Ladislav", "Mihnea", "Orlok", "Strigoi", "Tepesch", "Valakovic", "Zoran", "Brashov", "Cernat", "Andrescu", "Baltasar", "Beleznay", "Cristescu", "Dolingen", "Dragosh", "Erdelyi", "Ferenczy", "Gheorghiu", "Hollowmoor", "Ionescu", "Kovach", "Luminescu", "Marosvar", "Nadasky", "Obrenov", "Petrescu", "Rakoczy", "Sarkany", "Tokarev", "Ulmanov", "Vlaicu", "Zamfir", "Zubov"]
  },

  // Hexblood — eerie, fey- and hag-touched given names; witch-marked bynames.
  hexblood: {
    male: ["Alder", "Bram", "Corvin", "Crane", "Edric", "Fenwick", "Gorse", "Hollis", "Ivo", "Jasper", "Linden", "Mordecai", "Nettle", "Orin", "Pike", "Rowan", "Sloe", "Thorne", "Vael", "Wren", "Ash", "Briar", "Cael", "Dorian", "Elm", "Hawthorn", "Marsh", "Ren", "Sorrel", "Yarrow", "Barrow", "Bittern", "Blackthorn", "Bracken", "Cinder", "Cobweb", "Dogwood", "Elder", "Fennel", "Gallow", "Hemlock", "Holt", "Ives", "Knot", "Larch", "Mandrake", "Mistletoe", "Nightjar", "Oakshade", "Quill", "Reed", "Rook", "Sedge", "Sloethorn", "Tamarisk", "Teasel", "Vervain", "Willow", "Wormwood", "Yew"],
    female: ["Agatha", "Briony", "Cailin", "Dahlia", "Esme", "Fern", "Gisla", "Hazel", "Iris", "Juniper", "Lilith", "Morgaine", "Nessa", "Ondine", "Poppy", "Ravenna", "Sabine", "Tansy", "Una", "Verbena", "Willa", "Vesper", "Bryony", "Cordelia", "Elspeth", "Hester", "Marrow", "Rue", "Sable", "Wisteria", "Amaranth", "Belladonna", "Bindweed", "Celandine", "Columbine", "Dittany", "Eglantine", "Foxglove", "Gossamer", "Henbane", "Hollyhock", "Ivy", "Jessamine", "Larkspur", "Mallow", "Mandragora", "Nightbell", "Oleander", "Periwinkle", "Quince", "Ragwort", "Rosethorn", "Selene", "Silverweed", "Thistle", "Tormentil", "Violet", "Woodbine", "Yarrow", "Zinnia"],
    surnames: ["Nightshade", "Thornwood", "Bramblehex", "Mirewillow", "Crowsfeather", "Hollowoak", "Witchbane", "Ashthorn", "Gravemoss", "Hagsworn", "Ravenmark", "Bonebriar", "Blackbriar", "Cauldronmoss", "Crookfinger", "Fenwitch", "Glasseye", "Hollowhex", "Mirrorcurse", "Moonwither", "Owlbane", "Stitchmark", "Thornhex", "Wickerbone"]
  },

  // Reborn — archaic given names from a half-remembered past; grave-touched epithets.
  reborn: {
    male: ["Ambrose", "Barnaby", "Cornelius", "Drystan", "Edmund", "Faramund", "Gideon", "Hugh", "Isembard", "Jerome", "Lazarus", "Mortimer", "Nathaniel", "Osric", "Percival", "Quintus", "Roland", "Silas", "Thaddeus", "Ulric", "Valdemar", "Wystan", "Aldous", "Cedric", "Gilbert", "Lucan", "Phineas", "Reginald", "Tobias", "Walter", "Abelard", "Alban", "Alistair", "Bartholomew", "Benedict", "Clement", "Crispin", "Desmond", "Ellery", "Emery", "Ferdinand", "Godfrey", "Horace", "Ignatius", "Jasper", "Leland", "Leopold", "Lucius", "Matthias", "Nicodemus", "Orson", "Oswin", "Peregrine", "Rupert", "Solomon", "Terrence", "Ulysses", "Vincent", "Wendell", "Winthrop"],
    female: ["Agnes", "Beatrix", "Cecily", "Drusilla", "Edith", "Felicia", "Genevieve", "Hester", "Isolde", "Josephine", "Lavinia", "Margery", "Nerissa", "Ottilia", "Prudence", "Rosalind", "Sibyl", "Theodora", "Ursula", "Vespera", "Winifred", "Adelaide", "Clemence", "Dorothea", "Eudora", "Honoria", "Maude", "Philippa", "Rowena", "Sabella", "Almeria", "Arabella", "Augusta", "Blanche", "Constance", "Cordelia", "Delphine", "Eleanora", "Emmaline", "Euphemia", "Florence", "Gwendolen", "Harriet", "Imogen", "Jocelyn", "Katharine", "Letitia", "Marguerite", "Millicent", "Nettie", "Olympia", "Penelope", "Rosamond", "Seraphina", "Tabitha", "Temperance", "Verity", "Wilhelmina", "Yolande", "Zillah"],
    surnames: ["the Pale", "Gravewise", "the Ashen", "Hollowborn", "Stillbreath", "the Mourner", "Coldhand", "Lastlight", "Gravewalker", "Witherborn", "Dustmourn", "Palewatch", "Ashenwake", "Cerement", "Coffinborn", "Dirgewright", "Emberlost", "Graveshadow", "Knellbound", "Mournhollow", "Shroudwright", "Silentwake", "Tombwatch", "Windingsheet"]
  },

  // Lupin — half-caught lycanthropy, so a courtly Dementlieu voice over a bestial one.
  lupin: {
    male: ["Aubin", "Barnabe", "Caspard", "Dorian", "Emeric", "Fabrice", "Gaspard", "Guillem", "Hugo", "Jourdain", "Laurent", "Loup", "Marcel", "Nicolas", "Olivier", "Pascal", "Quentin", "Remy", "Sylvain", "Thibault", "Ulysse", "Valentin", "Yves", "Zacharie"],
    female: ["Adeline", "Bernadette", "Camille", "Delphine", "Elodie", "Fleur", "Genevieve", "Helene", "Isabeau", "Josette", "Lisette", "Margot", "Noelle", "Odette", "Perrine", "Quintine", "Renee", "Sabine", "Solange", "Therese", "Ursule", "Vivienne", "Yvette", "Zeline"],
    surnames: ["Beaumont", "Bellerose", "Blancmont", "Chastain", "Courvel", "Croixmort", "Delacroix", "Duvalier", "Fontaine", "Gravois", "Hurlant", "Lachance", "Lamarque", "Loupvert", "Maisonneuve", "Montclair", "Nocturne", "Perrauld", "Rocheval", "Sauvage", "Thibodeaux", "Valmont", "Verdier", "Vielleroux"]
  },

  // --- Spelljammer, Lorwyn, Ravnica, Planescape and Theros species ---

  // Aarakocra — trilled, whistled syllables; one name only.
  aarakocra: {
    male: ["Aera", "Aikk", "Aurek", "Cawl", "Chirriak", "Draeka", "Ekka", "Ferrik", "Heekra", "Ikri", "Kaawa", "Kirrek", "Krikka", "Nyekk", "Ohrra", "Pikkri", "Quorra", "Reeka", "Skraa", "Tirrik", "Veerek", "Whikk"],
    female: ["Aerri", "Chikka", "Elowri", "Feerra", "Hikki", "Ikra", "Jirri", "Keela", "Kirra", "Lyrra", "Meera", "Neeka", "Oorli", "Peera", "Qirri", "Reeli", "Seeri", "Tirra", "Uwrra", "Veela", "Wheera", "Zirri"],
    surnames: []
  },

  // Boggart — snorting, rummaging warren names from Lorwyn-Shadowmoor.
  boggart: {
    male: ["Bramblesnout", "Chuffwick", "Dibble", "Fennstump", "Grubb", "Hogsnout", "Jibb", "Knacker", "Mudwick", "Nib", "Pigsnort", "Quagg", "Rootle", "Scrump", "Snoutwick", "Sprag", "Stubb", "Thrum", "Tubb", "Wattle", "Widdershins", "Yark"],
    female: ["Bindle", "Brackenwick", "Chitter", "Dibbet", "Fennit", "Grubbin", "Hessle", "Jinny", "Knotwick", "Muddle", "Nibbet", "Pippet", "Quiggle", "Rooty", "Scrumple", "Snoutlet", "Spragget", "Stubbin", "Thrumble", "Tubbin", "Wattlet", "Yarrit"],
    surnames: ["Ashcrag", "Bitterburrow", "Cloudcrag", "Dungfen", "Frogmire", "Grubwarren", "Hollowstump", "Kinsburrow", "Mudbutton", "Nettlevale", "Oakenmire", "Peatbog", "Quillmire", "Rootbottom", "Sootfoot", "Stinkwell", "Thornmire", "Warrenwick", "Weedwhistle", "Wortpit"]
  },

  // Frogfolk — croaking bog names; myth-folk who carry no family name.
  frogfolk: {
    male: ["Bulrik", "Croakk", "Dribble", "Gribbit", "Hopp", "Jalik", "Krokk", "Lurrup", "Marrsh", "Nikk", "Orrub", "Pollik", "Quarrk", "Reedik", "Rivvit", "Skipp", "Sloshk", "Tadd", "Ulluk", "Vrokk", "Wadd", "Zopp"],
    female: ["Brekka", "Croaka", "Dewdrop", "Frilla", "Gribba", "Hopsa", "Jalla", "Kroka", "Lilla", "Marra", "Nikka", "Orrua", "Pollia", "Quarra", "Reeda", "Rivva", "Skippa", "Slosha", "Tadda", "Ulla", "Vrokka", "Wadda"],
    surnames: []
  },

  // Giff — gunnery and shipboard vocabulary, worn as proudly as a rank.
  giff: {
    male: ["Barrelgut", "Bombard", "Cannonade", "Culverin", "Dunnage", "Falconet", "Grapeshot", "Hawser", "Keelhaul", "Linstock", "Mortar", "Powderhorn", "Quarterdeck", "Ramrod", "Rigging", "Saltpeter", "Scuttle", "Serpentine", "Swivelgun", "Touchhole", "Volley", "Wadding"],
    female: ["Ballista", "Bastion", "Bosun", "Carronade", "Chainshot", "Cordite", "Demiculverin", "Fusillade", "Galleon", "Gunwale", "Halyard", "Kedge", "Lanyard", "Matchlock", "Petard", "Pinnace", "Rampart", "Salvo", "Shrapnel", "Spyglass", "Topsail", "Windlass", "Yardarm"],
    surnames: ["Blackpowder", "Broadside", "Cannonbrace", "Colorsguard", "Flintlock", "Gunnerson", "Highmast", "Ironbore", "Longbarrel", "Musketon", "Ordnance", "Powdermain", "Quickmatch", "Roundshot", "Shotline", "Siegewright", "Sternwatch", "Thunderbore", "Truebore", "Waterline"]
  },

  // Githyanki — harsh astral consonants; a crèche byname earned in service.
  githyanki: {
    male: ["Bavrak", "Cakkir", "Duvarik", "Ezrekh", "Gathok", "Harkar", "Ithvak", "Jerrak", "Kaavik", "Lethrak", "Mordhal", "Nekthar", "Ozmak", "Parrak", "Quorvak", "Rhakir", "Sethrak", "Tirvak", "Urkath", "Vazrak", "Yelkar", "Zerrak"],
    female: ["Bavrakh", "Cakkira", "Duvara", "Ezreth", "Gathra", "Harkira", "Ithva", "Jerra", "Kaavira", "Lethra", "Mordha", "Nekthra", "Ozma", "Parrha", "Quorva", "Rhakira", "Sethra", "Tirva", "Urkatha", "Vazra", "Yelka", "Zerra"],
    surnames: ["Astralbane", "Bladescourge", "Crechewarden", "Dreadlance", "Ghustilhaen", "Hulkhaal", "Kithrak", "Planewalker", "Queensblade", "Redsteel", "Silversword", "Skyreaver", "Starcleave", "Tirathkaal", "Vaultbreaker", "Voidlance", "Warlash", "Wraithsteel", "Xaarhaal", "Zaerithan"]
  },

  // Githzerai — the same roots worn smooth; monastery names in place of houses.
  githzerai: {
    male: ["Adaka", "Balorm", "Chodan", "Dahlvan", "Ezrenn", "Fenmar", "Guralm", "Hadran", "Ilvarn", "Jorenn", "Kavorn", "Lhandar", "Menvar", "Nordal", "Ovarn", "Pelmar", "Quandal", "Renvar", "Sendal", "Tovarn", "Ulmar", "Zerkan"],
    female: ["Adaya", "Baloria", "Chodra", "Dahlvi", "Ezrenna", "Fenmara", "Guralla", "Hadria", "Ilvarna", "Jorenna", "Kavora", "Lhandra", "Menvara", "Nordia", "Ovarna", "Pelmara", "Quandra", "Renvara", "Sendria", "Tovarna", "Ulmara", "Zerkana"],
    surnames: ["Calmfast", "Clearmind", "Deepstill", "Evenbreath", "Farsight", "Firstthought", "Gladefast", "Highsilence", "Ironcalm", "Longpatience", "Manystill", "Nearvoid", "Openpalm", "Quietstone", "Stillwater", "Sunfast", "Trueorder", "Unshaken", "Wakefulmind", "Wholemind"]
  },

  // Kenku — a name is a remembered sound, carried and repeated; never a surname.
  kenku: {
    male: ["Anvil Ring", "Bell Toll", "Bowstring", "Cart Wheel", "Chimney Smoke", "Cork Pop", "Door Creak", "Dropped Coin", "Gate Latch", "Glass Break", "Hammer Fall", "Hinge Whine", "Kettle Hiss", "Knife Whet", "Lock Click", "Nail Bite", "Rope Groan", "Saw Tooth", "Shutter Bang", "Stone Grind", "Tinder Strike", "Wagon Rattle"],
    female: ["Ash Sift", "Bird Call", "Candle Sputter", "Cat Hiss", "Cloth Tear", "Cup Chime", "Dog Yelp", "Feather Rustle", "Gull Cry", "Hearth Crackle", "Ice Crack", "Kettle Whistle", "Leaf Skitter", "Mouse Squeak", "Needle Snap", "Page Turn", "Rain Patter", "Ribbon Snap", "Sand Hiss", "Silk Whisper", "Water Drip", "Wind Moan"],
    surnames: []
  },

  // Kithkin — warm, communal given names; the family name names the holding.
  kithkin: {
    male: ["Ambrel", "Bramwell", "Cobrin", "Dunnock", "Eldrin", "Fennick", "Garvel", "Hobbard", "Jorrin", "Kembel", "Lomrick", "Merrow", "Norrel", "Orrick", "Peddrin", "Quennel", "Rundle", "Sedwick", "Tammel", "Wendrel", "Yarrow", "Zorrin"],
    female: ["Amberly", "Brennet", "Corabel", "Dunnet", "Elsbet", "Fennel", "Gwynnet", "Hobbet", "Jorrel", "Kembra", "Lomrel", "Merribel", "Norabel", "Orrel", "Peddra", "Quennet", "Rundel", "Sedbet", "Tammet", "Wendra", "Yarrel", "Zorabel"],
    surnames: ["Barleybright", "Beltwarden", "Bramblehedge", "Cartwheel", "Cornerpost", "Fairfield", "Gatherhearth", "Goodkin", "Hearthbound", "Kinwatch", "Lanternrow", "Meadowmarch", "Millstream", "Oatenfield", "Pastureborn", "Quietkin", "Sheafbinder", "Stilewalker", "Thatchrow", "Wellkeeper"]
  },

  // Loxodon — long, hummed vowels; herd names that describe a temperament.
  loxodon: {
    male: ["Aravaan", "Bhadrakan", "Chandavar", "Dhorumaan", "Ekavaran", "Gharvaan", "Havaduun", "Ilavaran", "Jhorumaan", "Kavaduun", "Lhoravaan", "Mahavaran", "Nadhuvaan", "Ohravaan", "Pravaduun", "Rhadavaran", "Savaduun", "Thoravaan", "Ulavaran", "Vhadhuvaan", "Yoravaan", "Zhavaduun"],
    female: ["Aravaani", "Bhadrani", "Chandavari", "Dhorumaani", "Ekavarani", "Gharvaani", "Havaduuni", "Ilavarani", "Jhorumaani", "Kavaduuni", "Lhoravaani", "Mahavarani", "Nadhuvaani", "Ohravaani", "Pravaduuni", "Rhadavarani", "Savaduuni", "Thoravaani", "Ulavarani", "Vhadhuvaani", "Yoravaani", "Zhavaduuni"],
    surnames: ["Calmtusk", "Deepvoice", "Drumheart", "Earthsong", "Gentlestep", "Greatear", "Groundshaker", "Hearthtusk", "Longmemory", "Mountainbrow", "Patientstone", "Quietthunder", "Riverwade", "Slowriver", "Stillmountain", "Stonehum", "Trunkwise", "Trueweight", "Watchfulhill", "Wideshoulder"]
  },

  // Tortle — a single name drawn from the shore the hatchling first walked.
  tortle: {
    male: ["Barkshell", "Coralback", "Dunwade", "Eddycreep", "Ferncarve", "Gravelgait", "Hollowshell", "Inkwade", "Kelpwalk", "Lagoon", "Mosscarve", "Nettlewade", "Oysterback", "Pebbleshell", "Quaywalk", "Reefgait", "Saltcarve", "Shoalback", "Tidewade", "Undershell", "Wavecarve", "Zephyrshell"],
    female: ["Anemone", "Brinewade", "Coralbloom", "Dewshell", "Eelgrass", "Foamback", "Gullshell", "Harborlight", "Islecarve", "Kelpsong", "Lilyshell", "Mirewade", "Nautilus", "Oceanhum", "Pearlback", "Quietcove", "Reedshell", "Sandsong", "Seagrass", "Tidebloom", "Verdantshell", "Whelkback"],
    surnames: []
  },

  // Centaur — Theros-flavoured classical given names; the herd supplies the byname.
  centaur: {
    male: ["Agrios", "Ankaios", "Belorix", "Chiravos", "Doriax", "Eurymed", "Galenos", "Hipparch", "Iolaos", "Kentaros", "Kerenos", "Lykaon", "Melanthos", "Nessarion", "Orestheus", "Pheraios", "Quirnax", "Rhadion", "Straton", "Thessalor", "Xanthos", "Zephyros"],
    female: ["Agriope", "Ankaria", "Beloria", "Chiravene", "Doriane", "Eurymene", "Galene", "Hipparche", "Iolanthe", "Kentara", "Kerenia", "Lykaia", "Melantha", "Nessaria", "Orestheia", "Pherane", "Quirnia", "Rhadia", "Stratonike", "Thessala", "Xanthea", "Zephyrine"],
    surnames: ["Brokenreed", "Dawnrun", "Duststride", "Fleetmane", "Galloprise", "Grassrunner", "Hoofthunder", "Longmeadow", "Nightgallop", "Openplain", "Quiverbrand", "Riverford", "Saltgrass", "Skyhoof", "Stormhoof", "Sunmane", "Thunderplain", "Wildgallop", "Windmane", "Yellowhill"]
  },

  // Leonin — rolling, roared given names; the pride name is the family name.
  leonin: {
    male: ["Arkanis", "Bahrun", "Baruun", "Cathrun", "Darokan", "Ekhar", "Garrun", "Haldrun", "Jarokan", "Kalirun", "Kherun", "Leoran", "Maruun", "Narokan", "Oriun", "Pardun", "Rakhan", "Sarokan", "Tarruun", "Urokan", "Varun", "Zarokan"],
    female: ["Arkania", "Bahruna", "Baruuna", "Cathruna", "Darokana", "Ekhara", "Garruna", "Haldruna", "Jarokana", "Kalira", "Kheruna", "Leorana", "Maruuna", "Narokana", "Oriuna", "Parduna", "Rakhana", "Sarokana", "Tarruuna", "Urokana", "Varuna", "Zarokana"],
    surnames: ["Brightmane", "Dawnpride", "Dunesong", "Firemane", "Goldenmaw", "Greatpride", "Hearthroar", "Ironclaw", "Lionsgate", "Longstride", "Manebearer", "Noonhunt", "Prideheart", "Redmaw", "Roarkeeper", "Sandpride", "Sunmane", "Swiftclaw", "Thornmane", "Wideroar"]
  },

  // Minotaur — bellowed given names; labyrinth-and-horn bynames.
  minotaur: {
    male: ["Argathos", "Bellorn", "Brakkon", "Cerathos", "Doronn", "Ekkathos", "Gorathon", "Harkkon", "Ithron", "Kalathos", "Kethros", "Lomarr", "Morrathon", "Nekkos", "Orrathos", "Pyrathon", "Rhakkon", "Sorathos", "Tharrun", "Ulkathos", "Vorrathon", "Zarrathos"],
    female: ["Argatha", "Bellorna", "Brakka", "Ceratha", "Doronna", "Ekkatha", "Goratha", "Harkka", "Ithrona", "Kalatha", "Kethra", "Lomarra", "Morratha", "Nekka", "Orratha", "Pyratha", "Rhakka", "Soratha", "Tharra", "Ulkatha", "Vorratha", "Zarratha"],
    surnames: ["Axehorn", "Blackhoof", "Bloodhorn", "Bronzehide", "Deepmaze", "Doubleaxe", "Gorehorn", "Hornbreaker", "Ironhoof", "Labyrinthborn", "Longhorn", "Mazewalker", "Ruinhoof", "Skullhorn", "Stonehoof", "Thunderhoof", "Tombmaze", "Truehorn", "Wallbreaker", "Wrathhorn"]
  },

  // Satyr — revel names; the byname is whatever the satyr is known for at the feast.
  satyr: {
    male: ["Amphion", "Bakkos", "Chrysos", "Dionaros", "Eurykles", "Faunos", "Gorgias", "Hylas", "Iakkos", "Kallias", "Kerasos", "Lyrios", "Melios", "Nikanos", "Oinops", "Pallios", "Pyrrhos", "Rhodios", "Silvanos", "Thyrsos", "Vinarios", "Xanthios", "Zagreos"],
    female: ["Amphia", "Bakkira", "Chrysia", "Dionara", "Eurykleia", "Fauna", "Gorgo", "Hylaia", "Iakka", "Kallia", "Kerasia", "Lyria", "Melia", "Nikana", "Oinopia", "Pallia", "Rhodia", "Silvana", "Thyrsia", "Vinaria", "Xanthia", "Zagrea"],
    surnames: ["Cupbearer", "Dancefoot", "Drumhoof", "Feastcaller", "Fluteheart", "Grapecrusher", "Hoofstamp", "Joybringer", "Laughmaker", "Merrymaker", "Nightreveler", "Pipesong", "Revelhoof", "Songleader", "Summerhoof", "Tambourhoof", "Vinecrown", "Wildpiper", "Winehorn", "Yearlong"]
  },

  // Triton — deep-sea given names; the byname names the reef or trench guarded.
  triton: {
    male: ["Aquarion", "Brinnos", "Coralis", "Cyrenos", "Delphinos", "Echinos", "Fathomar", "Glaucion", "Halios", "Kymaris", "Lyrion", "Marinos", "Nerion", "Okeanos", "Pelagios", "Quorion", "Rheumar", "Sirenos", "Thalassion", "Undarion", "Vorthalis", "Zephalion"],
    female: ["Aquaria", "Brinna", "Coralia", "Cyrena", "Delphine", "Echina", "Fathoma", "Glaucia", "Halia", "Kymara", "Lyrissa", "Marina", "Nerissa", "Okeania", "Pelagia", "Quoria", "Rheuma", "Sirena", "Thalassia", "Undaria", "Vorthalia", "Zephalia"],
    surnames: ["Coralborn", "Deepcurrent", "Driftglass", "Ebbmarch", "Foamcrest", "Glasswave", "Kelpward", "Lightfathom", "Pearlguard", "Reefwarden", "Saltbrine", "Seabastion", "Shellsong", "Stillabyss", "Sunkendeep", "Tidewarden", "Trenchkeeper", "Wavecaller", "Whitecrest", "Wrackline"]
  },

  // Fairy — small, bright, hedgerow names; no family name to speak of.
  fairy: {
    male: ["Acorn", "Bramblebee", "Cricket", "Dewdrop", "Fernfrond", "Gladwing", "Hushwing", "Inkcap", "Jackdaw", "Kindleflit", "Lanternbug", "Mothwing", "Nettlewing", "Oakapple", "Pollenpuff", "Quickthorn", "Ribwing", "Silverflit", "Thistlefly", "Twigwhistle", "Wispwing", "Yarrowflit"],
    female: ["Aster", "Bellbloom", "Cobwebbe", "Dandelion", "Elderflower", "Fernlight", "Glimmerwing", "Honeydew", "Ivyflit", "Jewelwing", "Kissingbud", "Lacewing", "Meadowsweet", "Nightbloom", "Orchidwing", "Petalfall", "Quillflit", "Rosehip", "Snowdrop", "Thimbleweed", "Violetwing", "Willowisp"],
    surnames: []
  },

  // Harengon — bounding meadow names, taken from whatever the warren does well.
  harengon: {
    male: ["Bramblehop", "Burrow", "Clovermarch", "Drumfoot", "Ferndash", "Grasswhisk", "Haremarch", "Jumpwell", "Kicklebrush", "Leapwood", "Longear", "Meadowdash", "Nettlehop", "Oatfield", "Pebblebound", "Quickhop", "Rushfoot", "Sedgeleap", "Thumpwell", "Tuftear", "Warrenbound", "Whiskerbrush", "Yarrowhop", "Zigzag"],
    female: ["Barleyhop", "Bluebell", "Cloverdown", "Daisyleap", "Edgewhisk", "Fernwhisper", "Gorsebound", "Hazelhop", "Ivyleap", "Juniperdash", "Kittlehop", "Lupinleap", "Mallowhop", "Nosetwitch", "Orchardleap", "Primrose", "Quillhop", "Rabbitfoot", "Sorrelhop", "Thistlewhisk", "Violetleap", "Willowhop"],
    surnames: []
  },

  // Fallback for any unmapped species — a broad, neutral fantasy voice, deliberately the largest pool.
  default: {
    male: ["Aric", "Bram", "Caelum", "Doran", "Eron", "Fendrel", "Galdor", "Halric", "Joren", "Kael", "Soren", "Theron", "Aldan", "Borin", "Calder", "Daric", "Edric", "Faelin", "Gareth", "Hadon", "Ilric", "Jovan", "Korin", "Larem", "Maric", "Nerian", "Orin", "Perrin", "Quill", "Raen", "Sevrin", "Talen", "Ulric", "Varic", "Wystan", "Aldric", "Bevan", "Cael", "Doren", "Emeric", "Faron", "Gildas", "Haldor", "Ivor", "Jarek", "Kelvar", "Loran", "Merek", "Noren", "Phelan", "Rowan", "Serik", "Tomar", "Veylin", "Aeron", "Anwyl", "Arden", "Barric", "Brannic", "Caspian", "Cerric", "Corvan", "Dalen", "Darion", "Drevan", "Eamon", "Elric", "Emmeric", "Evrard", "Fenrick", "Fintan", "Galen", "Garvan", "Gideon", "Halden", "Harlin", "Idris", "Isen", "Jarric", "Jorven", "Kaeric", "Kester", "Laric", "Leoric", "Lucan", "Maldan", "Marek", "Nolric", "Oswin", "Owain", "Pellin", "Quinlan", "Rafferty", "Renn", "Roderin", "Sabin", "Sedric", "Sorrel", "Tavin", "Thorne", "Tobias", "Torren", "Ulmar", "Vandric", "Vesric", "Warric", "Yelric", "Zorin"],
    female: ["Alina", "Brisa", "Caelia", "Dara", "Elara", "Fenna", "Iria", "Lyra", "Mira", "Nessa", "Sela", "Wren", "Aelis", "Aria", "Brenna", "Bria", "Calla", "Cora", "Daevia", "Delwyn", "Eira", "Elys", "Faye", "Fiora", "Genna", "Gwyneth", "Halia", "Hesper", "Ilda", "Iola", "Juna", "Kaela", "Lira", "Liora", "Maelis", "Maeve", "Nira", "Nyssa", "Orla", "Oriel", "Petra", "Riala", "Rina", "Saela", "Senna", "Talia", "Tamsin", "Una", "Vaela", "Vesna", "Wenna", "Yara", "Ysla", "Zinna", "Aderyn", "Alenna", "Amara", "Anwen", "Arvenna", "Belira", "Briony", "Caela", "Carys", "Celia", "Danae", "Deryn", "Elaria", "Elowyn", "Enid", "Esme", "Ferelith", "Fiala", "Gwenna", "Hallis", "Hester", "Idella", "Ilyana", "Isolde", "Jessa", "Junia", "Kaia", "Kerra", "Laelia", "Linnea", "Lucia", "Mabyn", "Marisol", "Mireth", "Nerida", "Niamh", "Odessa", "Ondine", "Perella", "Quenna", "Rhoswen", "Rilla", "Rosalind", "Sabra", "Seleste", "Sorcha", "Sylvine", "Tamsyn", "Thalia", "Tirzah", "Verena", "Wynne", "Yvette", "Zelia"],
    surnames: ["Ashfell", "Brightwood", "Duskwind", "Emberfall", "Hollowmere", "Ravensworn", "Stormcrest", "Wildemoor", "Amberhill", "Blackfen", "Briarwood", "Cinderhall", "Dawnmere", "Eastmarch", "Fairholt", "Frostvale", "Greymoor", "Hartwell", "Ironvale", "Larkhollow", "Mistvale", "Nightingale", "Oakenfell", "Pinehurst", "Quarryhill", "Ravenmoor", "Redhollow", "Silverdale", "Stagmoor", "Thornfield", "Underwood", "Valebrook", "Westwind", "Whitethorn", "Wyrmwood", "Yewdale", "Ashbourne", "Coldwater", "Deepfen", "Elderglen", "Foxglove", "Grimwald", "Marshwick", "Thistlewood", "Wolfsbane", "Alderbrook", "Ashenhollow", "Barrowfield", "Bellmoor", "Birchvale", "Brackenhill", "Bramblegate", "Brightwater", "Cairnwell", "Candlewick", "Cloudmere", "Crowsmoor", "Dawnbarrow", "Dellwood", "Duskhollow", "Elmwater", "Everglade", "Fallowmoor", "Fernhollow", "Fogmere", "Gallowsgate", "Glenmarch", "Hawkridge", "Hearthmoor", "Hollybrook", "Ivybrook", "Kestrelmoor", "Lanternhill", "Longbarrow", "Mirefield", "Mosswood", "Northgate", "Oakenhollow", "Pinefall", "Rainmoor", "Reedmarch", "Rookhollow", "Sablewood", "Shalebrook", "Snowvale", "Stonebrook", "Thornhaven", "Wanderwood", "Willowmere", "Wolfmere"]
  }
};

/**
 * Maps a species' dnd5e `system.identifier` to a style key in {@link NAME_STYLES}.
 * Lineage variants collapse to their parent style (e.g. every elf identifier -> "elf").
 * An identifier absent here falls through to "default".
 *
 * Keys are matched after slugification, so a species that ships without an identifier
 * — every Ravenloft lineage does — still resolves through its name ("Elf, Drow" ->
 * "elf-drow", "Kithkin, Shadowmoor" -> "kithkin-shadowmoor"). Both the 2014 spellings
 * ("high-elf") and the 2024 ones ("elf-high") are listed for that reason.
 */
export const SPECIES_STYLE_ALIASES = {
  human: "human", variant: "human",
  elf: "elf", "high-elf": "elf", "wood-elf": "elf", drow: "elf", "dark-elf": "elf", eladrin: "elf", "sea-elf": "elf", "shadar-kai": "elf",
  "elf-high": "elf", "elf-wood": "elf", "elf-drow": "elf", "elf-lorwyn": "elf", "elf-shadowmoor": "elf", "astral-elf": "elf", "pallid-elf": "elf",
  dwarf: "dwarf", "hill-dwarf": "dwarf", "mountain-dwarf": "dwarf", duergar: "dwarf",
  halfling: "halfling", lightfoot: "halfling", "lightfoot-halfling": "halfling", stout: "halfling", "stout-halfling": "halfling", ghostwise: "halfling",
  gnome: "gnome", "forest-gnome": "gnome", "rock-gnome": "gnome", "deep-gnome": "gnome", svirfneblin: "gnome",
  "gnome-forest": "gnome", "gnome-rock": "gnome", "gnome-deep": "gnome",
  dragonborn: "dragonborn", "dragonborn-gem": "dragonborn", "gem-dragonborn": "dragonborn", "chromatic-dragonborn": "dragonborn", "metallic-dragonborn": "dragonborn",
  tiefling: "tiefling", "tiefling-abyssal": "tiefling", "tiefling-chthonic": "tiefling", "tiefling-infernal": "tiefling",
  "abyssal-tiefling": "tiefling", "chthonic-tiefling": "tiefling", "infernal-tiefling": "tiefling",
  "half-orc": "half-orc",
  orc: "orc",
  "half-elf": "half-elf", khoravar: "half-elf",
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
  // Ravenloft lineages — these ship with no identifier, so they resolve through their names
  dhampir: "dhampir", hexblood: "hexblood", reborn: "reborn", lupin: "lupin",
  // Spelljammer, Planescape, Lorwyn, Ravnica and Theros species
  aarakocra: "aarakocra",
  boggart: "boggart",
  frogfolk: "frogfolk", grippli: "frogfolk",
  giff: "giff",
  gith: "githyanki", githyanki: "githyanki",
  githzerai: "githzerai",
  kenku: "kenku",
  kithkin: "kithkin", "kithkin-shadowmoor": "kithkin",
  loxodon: "loxodon",
  tortle: "tortle",
  centaur: "centaur",
  leonin: "leonin",
  minotaur: "minotaur",
  satyr: "satyr",
  triton: "triton",
  fairy: "fairy",
  harengon: "harengon"
};
