export type Voivodeship = {
  id: string;
  name: string;
  cities: string[];
};

export const VOIVODESHIPS: Voivodeship[] = [
  {
    id: "dolnoslaskie",
    name: "Dolnośląskie",
    cities: [
      "Wrocław", "Wałbrzych", "Legnica", "Jelenia Góra", "Lubin", "Głogów",
      "Świdnica", "Bolesławiec", "Oleśnica", "Dzierżoniów", "Zgorzelec", "Oława",
      "Kłodzko", "Bielawa", "Świebodzice", "Nowa Ruda", "Jawor", "Polkowice",
      "Oborniki Śląskie", "Trzebnica", "Strzelin", "Środa Śląska", "Kamienna Góra",
      "Lubań", "Złotoryja", "Chojnów", "Góra", "Milicz", "Wołów", "Ząbkowice Śląskie",
      "Bogatynia", "Pieszyce", "Siechnice", "Brzeg Dolny", "Jelcz-Laskowice",
    ],
  },
  {
    id: "kujawsko-pomorskie",
    name: "Kujawsko-pomorskie",
    cities: [
      "Bydgoszcz", "Toruń", "Włocławek", "Grudziądz", "Inowrocław", "Brodnica",
      "Świecie", "Chełmno", "Nakło nad Notecią", "Rypin", "Chełmża", "Solec Kujawski",
      "Aleksandrów Kujawski", "Ciechocinek", "Golub-Dobrzyń", "Lipno", "Mogilno",
      "Radziejów", "Sępólno Krajeńskie", "Tuchola", "Wąbrzeźno", "Żnin", "Kruszwica",
      "Koronowo", "Barcin", "Janikowo", "Szubin", "Więcbork", "Nowe", "Strzelno",
    ],
  },
  {
    id: "lubelskie",
    name: "Lubelskie",
    cities: [
      "Lublin", "Chełm", "Zamość", "Biała Podlaska", "Puławy", "Świdnik",
      "Kraśnik", "Łuków", "Biłgoraj", "Lubartów", "Tomaszów Lubelski", "Krasnystaw",
      "Hrubieszów", "Ryki", "Międzyrzec Podlaski", "Janów Lubelski", "Parczew",
      "Radzyń Podlaski", "Włodawa", "Opole Lubelskie", "Bychawa", "Poniatowa",
      "Dęblin", "Terespol", "Szczebrzeszyn", "Zwierzyniec", "Bełżyce", "Nałęczów",
      "Rejowiec Fabryczny", "Józefów",
    ],
  },
  {
    id: "lubuskie",
    name: "Lubuskie",
    cities: [
      "Zielona Góra", "Gorzów Wielkopolski", "Nowa Sól", "Żary", "Żagań",
      "Świebodzin", "Międzyrzecz", "Słubice", "Kostrzyn nad Odrą", "Sulechów",
      "Gubin", "Krosno Odrzańskie", "Wschowa", "Strzelce Krajeńskie", "Drezdenko",
      "Skwierzyna", "Lubsko", "Szprotawa", "Sulęcin", "Witnica", "Rzepin",
      "Czerwieńsk", "Kożuchów", "Dobiegniew", "Nowogród Bobrzański",
    ],
  },
  {
    id: "lodzkie",
    name: "Łódzkie",
    cities: [
      "Łódź", "Piotrków Trybunalski", "Pabianice", "Tomaszów Mazowiecki",
      "Bełchatów", "Zgierz", "Skierniewice", "Radomsko", "Kutno", "Sieradz",
      "Zduńska Wola", "Łowicz", "Ozorków", "Wieluń", "Aleksandrów Łódzki",
      "Konstantynów Łódzki", "Opoczno", "Rawa Mazowiecka", "Łask", "Głowno",
      "Brzeziny", "Koluszki", "Poddębice", "Łęczyca", "Wieruszów", "Pajęczno",
      "Zelów", "Tuszyn", "Stryków", "Krośniewice", "Działoszyn", "Warta",
    ],
  },
  {
    id: "malopolskie",
    name: "Małopolskie",
    cities: [
      "Kraków", "Tarnów", "Nowy Sącz", "Oświęcim", "Chrzanów", "Olkusz",
      "Nowy Targ", "Bochnia", "Zakopane", "Wadowice", "Myślenice", "Gorlice",
      "Skawina", "Andrychów", "Trzebinia", "Brzesko", "Libiąż", "Wieliczka",
      "Limanowa", "Zabierzów", "Krzeszowice", "Niepołomice", "Dąbrowa Tarnowska",
      "Miechów", "Sucha Beskidzka", "Maków Podhalański", "Rabka-Zdrój", "Kęty",
      "Mszana Dolna", "Proszowice", "Nowy Wiśnicz", "Bukowno", "Alwernia", "Muszyna",
    ],
  },
  {
    id: "mazowieckie",
    name: "Mazowieckie",
    cities: [
      "Warszawa", "Radom", "Płock", "Siedlce", "Pruszków", "Legionowo",
      "Ostrołęka", "Ciechanów", "Otwock", "Piaseczno", "Wołomin", "Żyrardów",
      "Mińsk Mazowiecki", "Nowy Dwór Mazowiecki", "Grodzisk Mazowiecki", "Marki",
      "Ząbki", "Sochaczew", "Wyszków", "Płońsk", "Gostynin", "Sierpc", "Garwolin",
      "Kozienice", "Pułtusk", "Maków Mazowiecki", "Mława", "Grójec", "Sokołów Podlaski",
      "Węgrów", "Łosice", "Przasnysz", "Zielonka", "Konstancin-Jeziorna", "Józefów",
      "Błonie", "Ożarów Mazowiecki", "Warka", "Białobrzegi", "Szydłowiec",
    ],
  },
  {
    id: "opolskie",
    name: "Opolskie",
    cities: [
      "Opole", "Kędzierzyn-Koźle", "Nysa", "Brzeg", "Kluczbork", "Strzelce Opolskie",
      "Prudnik", "Krapkowice", "Namysłów", "Olesno", "Głubczyce", "Głuchołazy",
      "Zdzieszowice", "Ozimek", "Praszka", "Grodków", "Zawadzkie", "Gogolin",
      "Lewin Brzeski", "Niemodlin", "Wołczyn", "Paczków", "Otmuchów", "Biała",
      "Baborów",
    ],
  },
  {
    id: "podkarpackie",
    name: "Podkarpackie",
    cities: [
      "Rzeszów", "Przemyśl", "Stalowa Wola", "Mielec", "Tarnobrzeg", "Krosno",
      "Dębica", "Jarosław", "Sanok", "Jasło", "Łańcut", "Przeworsk", "Ropczyce",
      "Nisko", "Leżajsk", "Lubaczów", "Ustrzyki Dolne", "Brzozów", "Kolbuszowa",
      "Strzyżów", "Sędziszów Małopolski", "Nowa Dęba", "Głogów Małopolski",
      "Rymanów", "Radymno", "Boguchwała", "Pilzno", "Dynów", "Tyczyn", "Zagórz",
    ],
  },
  {
    id: "podlaskie",
    name: "Podlaskie",
    cities: [
      "Białystok", "Suwałki", "Łomża", "Augustów", "Bielsk Podlaski",
      "Zambrów", "Hajnówka", "Grajewo", "Sokółka", "Siemiatycze", "Wysokie Mazowieckie",
      "Mońki", "Kolno", "Łapy", "Czarna Białostocka", "Dąbrowa Białostocka",
      "Sejny", "Ciechanowiec", "Choroszcz", "Wasilków", "Supraśl", "Knyszyn",
      "Szczuczyn", "Lipsk", "Rajgród",
    ],
  },
  {
    id: "pomorskie",
    name: "Pomorskie",
    cities: [
      "Gdańsk", "Gdynia", "Słupsk", "Tczew", "Starogard Gdański", "Wejherowo",
      "Rumia", "Chojnice", "Malbork", "Kwidzyn", "Lębork", "Sopot", "Pruszcz Gdański",
      "Reda", "Kościerzyna", "Człuchów", "Bytów", "Puck", "Ustka", "Nowy Dwór Gdański",
      "Sztum", "Gniew", "Skarszewy", "Żukowo", "Kartuzy", "Władysławowo", "Hel",
      "Miastko", "Czersk", "Brusy", "Prabuty", "Debrzno",
    ],
  },
  {
    id: "slaskie",
    name: "Śląskie",
    cities: [
      "Katowice", "Częstochowa", "Sosnowiec", "Gliwice", "Zabrze", "Bytom",
      "Bielsko-Biała", "Rybnik", "Tychy", "Dąbrowa Górnicza", "Chorzów",
      "Jastrzębie-Zdrój", "Jaworzno", "Cieszyn", "Mysłowice", "Siemianowice Śląskie",
      "Ruda Śląska", "Świętochłowice", "Piekary Śląskie", "Żory", "Będzin",
      "Zawiercie", "Tarnowskie Góry", "Racibórz", "Wodzisław Śląski", "Mikołów",
      "Knurów", "Czechowice-Dziedzice", "Pszczyna", "Lubliniec", "Myszków",
      "Czeladź", "Żywiec", "Bieruń", "Łaziska Górne", "Rydułtowy", "Ustroń",
      "Skoczów", "Kłobuck", "Pyskowice",
    ],
  },
  {
    id: "swietokrzyskie",
    name: "Świętokrzyskie",
    cities: [
      "Kielce", "Ostrowiec Świętokrzyski", "Starachowice", "Skarżysko-Kamienna",
      "Sandomierz", "Końskie", "Jędrzejów", "Busko-Zdrój", "Staszów", "Pińczów",
      "Włoszczowa", "Opatów", "Kazimierza Wielka", "Chmielnik", "Suchedniów",
      "Morawica", "Chęciny", "Małogoszcz", "Bodzentyn", "Ćmielów", "Zawichost",
      "Połaniec", "Osiek", "Sędziszów", "Daleszyce",
    ],
  },
  {
    id: "warminsko-mazurskie",
    name: "Warmińsko-mazurskie",
    cities: [
      "Olsztyn", "Elbląg", "Ełk", "Ostróda", "Iława", "Giżycko",
      "Kętrzyn", "Szczytno", "Bartoszyce", "Mrągowo", "Działdowo", "Pisz",
      "Braniewo", "Lidzbark Warmiński", "Olecko", "Nowe Miasto Lubawskie",
      "Węgorzewo", "Gołdap", "Nidzica", "Morąg", "Pasłęk", "Dobre Miasto",
      "Lubawa", "Orneta", "Biskupiec", "Olsztynek", "Ruciane-Nida", "Mikołajki",
      "Susz", "Barczewo",
    ],
  },
  {
    id: "wielkopolskie",
    name: "Wielkopolskie",
    cities: [
      "Poznań", "Kalisz", "Konin", "Piła", "Ostrów Wielkopolski", "Gniezno",
      "Leszno", "Śrem", "Swarzędz", "Krotoszyn", "Jarocin", "Września",
      "Luboń", "Turek", "Koło", "Środa Wielkopolska", "Wągrowiec", "Kościan",
      "Chodzież", "Rawicz", "Oborniki", "Nowy Tomyśl", "Szamotuły", "Złotów",
      "Pleszew", "Grodzisk Wielkopolski", "Wolsztyn", "Trzcianka", "Czarnków",
      "Murowana Goślina", "Puszczykowo", "Mosina", "Kępno", "Ostrzeszów", "Słupca",
    ],
  },
  {
    id: "zachodniopomorskie",
    name: "Zachodniopomorskie",
    cities: [
      "Szczecin", "Koszalin", "Stargard", "Kołobrzeg", "Świnoujście",
      "Szczecinek", "Police", "Wałcz", "Gryfino", "Białogard", "Goleniów",
      "Nowogard", "Gryfice", "Choszczno", "Drawsko Pomorskie", "Świdwin",
      "Sławno", "Darłowo", "Myślibórz", "Dębno", "Barlinek", "Pyrzyce",
      "Trzebiatów", "Kamień Pomorski", "Międzyzdroje", "Łobez", "Połczyn-Zdrój",
      "Chojna", "Recz", "Karlino",
    ],
  },
];

export function getVoivodeship(id: string): Voivodeship | undefined {
  return VOIVODESHIPS.find((v) => v.id === id);
}

/** Warianty fraz branżowych — zwiększają pokrycie wyników w jednym mieście. */
export function queryVariants(industry: string): string[] {
  const base = industry.trim();
  const variants = [base, `usługi ${base}`, `${base} firma`];
  return [...new Set(variants.map((v) => v.trim()).filter(Boolean))];
}
