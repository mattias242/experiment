// Kommun → riksdagsvalkrets.
// Sverige har 29 valkretsar till riksdagen. I de flesta län är valkretsen hela
// länet, men Stockholms, Skåne och Västra Götalands län är delade.
// Listan är kurerad för hand – hittar du ett fel, öppna gärna ett ärende.
'use strict';

const VALKRETSAR = [
  'Blekinge län',
  'Dalarnas län',
  'Gotlands län',
  'Gävleborgs län',
  'Göteborgs kommun',
  'Hallands län',
  'Jämtlands län',
  'Jönköpings län',
  'Kalmar län',
  'Kronobergs län',
  'Malmö kommun',
  'Norrbottens län',
  'Skåne läns norra och östra',
  'Skåne läns södra',
  'Skåne läns västra',
  'Stockholms kommun',
  'Stockholms län',
  'Södermanlands län',
  'Uppsala län',
  'Värmlands län',
  'Västerbottens län',
  'Västernorrlands län',
  'Västmanlands län',
  'Västra Götalands läns norra',
  'Västra Götalands läns södra',
  'Västra Götalands läns västra',
  'Västra Götalands läns östra',
  'Örebro län',
  'Östergötlands län',
];

const KOMMUN_TILL_VALKRETS = (() => {
  const m = {};
  const lagg = (valkrets, kommuner) => {
    for (const k of kommuner) m[k] = valkrets;
  };

  lagg('Stockholms kommun', ['Stockholm']);
  lagg('Stockholms län', [
    'Botkyrka', 'Danderyd', 'Ekerö', 'Haninge', 'Huddinge', 'Järfälla',
    'Lidingö', 'Nacka', 'Norrtälje', 'Nykvarn', 'Nynäshamn', 'Salem',
    'Sigtuna', 'Sollentuna', 'Solna', 'Sundbyberg', 'Södertälje', 'Tyresö',
    'Täby', 'Upplands Väsby', 'Upplands-Bro', 'Vallentuna', 'Vaxholm',
    'Värmdö', 'Österåker',
  ]);
  lagg('Uppsala län', [
    'Enköping', 'Heby', 'Håbo', 'Knivsta', 'Tierp', 'Uppsala',
    'Älvkarleby', 'Östhammar',
  ]);
  lagg('Södermanlands län', [
    'Eskilstuna', 'Flen', 'Gnesta', 'Katrineholm', 'Nyköping', 'Oxelösund',
    'Strängnäs', 'Trosa', 'Vingåker',
  ]);
  lagg('Östergötlands län', [
    'Boxholm', 'Finspång', 'Kinda', 'Linköping', 'Mjölby', 'Motala',
    'Norrköping', 'Söderköping', 'Vadstena', 'Valdemarsvik', 'Ydre',
    'Åtvidaberg', 'Ödeshög',
  ]);
  lagg('Jönköpings län', [
    'Aneby', 'Eksjö', 'Gislaved', 'Gnosjö', 'Habo', 'Jönköping', 'Mullsjö',
    'Nässjö', 'Sävsjö', 'Tranås', 'Vaggeryd', 'Vetlanda', 'Värnamo',
  ]);
  lagg('Kronobergs län', [
    'Alvesta', 'Lessebo', 'Ljungby', 'Markaryd', 'Tingsryd', 'Uppvidinge',
    'Växjö', 'Älmhult',
  ]);
  lagg('Kalmar län', [
    'Borgholm', 'Emmaboda', 'Hultsfred', 'Högsby', 'Kalmar', 'Mönsterås',
    'Mörbylånga', 'Nybro', 'Oskarshamn', 'Torsås', 'Vimmerby', 'Västervik',
  ]);
  lagg('Gotlands län', ['Gotland', 'Visby']);
  lagg('Blekinge län', [
    'Karlshamn', 'Karlskrona', 'Olofström', 'Ronneby', 'Sölvesborg',
  ]);
  lagg('Malmö kommun', ['Malmö']);
  lagg('Skåne läns västra', [
    'Bjuv', 'Eslöv', 'Helsingborg', 'Höganäs', 'Landskrona', 'Svalöv',
  ]);
  lagg('Skåne läns södra', [
    'Burlöv', 'Hörby', 'Höör', 'Kävlinge', 'Lomma', 'Lund', 'Sjöbo',
    'Skurup', 'Staffanstorp', 'Svedala', 'Trelleborg', 'Vellinge', 'Ystad',
  ]);
  lagg('Skåne läns norra och östra', [
    'Bromölla', 'Båstad', 'Hässleholm', 'Klippan', 'Kristianstad', 'Osby',
    'Perstorp', 'Simrishamn', 'Tomelilla', 'Åstorp', 'Ängelholm',
    'Örkelljunga', 'Östra Göinge',
  ]);
  lagg('Hallands län', [
    'Falkenberg', 'Halmstad', 'Hylte', 'Kungsbacka', 'Laholm', 'Varberg',
  ]);
  lagg('Göteborgs kommun', ['Göteborg']);
  lagg('Västra Götalands läns västra', [
    'Härryda', 'Kungälv', 'Lysekil', 'Munkedal', 'Mölndal', 'Orust',
    'Partille', 'Sotenäs', 'Stenungsund', 'Strömstad', 'Tanum', 'Tjörn',
    'Uddevalla', 'Öckerö',
  ]);
  lagg('Västra Götalands läns norra', [
    'Ale', 'Alingsås', 'Bengtsfors', 'Dals-Ed', 'Färgelanda', 'Herrljunga',
    'Lerum', 'Lilla Edet', 'Mellerud', 'Trollhättan', 'Vårgårda',
    'Vänersborg', 'Åmål',
  ]);
  lagg('Västra Götalands läns södra', [
    'Bollebygd', 'Borås', 'Mark', 'Svenljunga', 'Tranemo', 'Ulricehamn',
  ]);
  lagg('Västra Götalands läns östra', [
    'Essunga', 'Falköping', 'Grästorp', 'Gullspång', 'Götene', 'Hjo',
    'Karlsborg', 'Lidköping', 'Mariestad', 'Skara', 'Skövde', 'Tibro',
    'Tidaholm', 'Töreboda', 'Vara',
  ]);
  lagg('Värmlands län', [
    'Arvika', 'Eda', 'Filipstad', 'Forshaga', 'Grums', 'Hagfors',
    'Hammarö', 'Karlstad', 'Kil', 'Kristinehamn', 'Munkfors', 'Storfors',
    'Sunne', 'Säffle', 'Torsby', 'Årjäng',
  ]);
  lagg('Örebro län', [
    'Askersund', 'Degerfors', 'Hallsberg', 'Hällefors', 'Karlskoga',
    'Kumla', 'Laxå', 'Lekeberg', 'Lindesberg', 'Ljusnarsberg', 'Nora',
    'Örebro',
  ]);
  lagg('Västmanlands län', [
    'Arboga', 'Fagersta', 'Hallstahammar', 'Kungsör', 'Köping', 'Norberg',
    'Sala', 'Skinnskatteberg', 'Surahammar', 'Västerås',
  ]);
  lagg('Dalarnas län', [
    'Avesta', 'Borlänge', 'Falun', 'Gagnef', 'Hedemora', 'Leksand',
    'Ludvika', 'Malung-Sälen', 'Mora', 'Orsa', 'Rättvik', 'Smedjebacken',
    'Säter', 'Vansbro', 'Älvdalen',
  ]);
  lagg('Gävleborgs län', [
    'Bollnäs', 'Gävle', 'Hofors', 'Hudiksvall', 'Ljusdal', 'Nordanstig',
    'Ockelbo', 'Ovanåker', 'Sandviken', 'Söderhamn',
  ]);
  lagg('Västernorrlands län', [
    'Härnösand', 'Kramfors', 'Sollefteå', 'Sundsvall', 'Timrå', 'Ånge',
    'Örnsköldsvik',
  ]);
  lagg('Jämtlands län', [
    'Berg', 'Bräcke', 'Härjedalen', 'Krokom', 'Ragunda', 'Strömsund',
    'Åre', 'Östersund',
  ]);
  lagg('Västerbottens län', [
    'Bjurholm', 'Dorotea', 'Lycksele', 'Malå', 'Nordmaling', 'Norsjö',
    'Robertsfors', 'Skellefteå', 'Sorsele', 'Storuman', 'Umeå',
    'Vilhelmina', 'Vindeln', 'Vännäs', 'Åsele',
  ]);
  lagg('Norrbottens län', [
    'Arjeplog', 'Arvidsjaur', 'Boden', 'Gällivare', 'Haparanda',
    'Jokkmokk', 'Kalix', 'Kiruna', 'Luleå', 'Pajala', 'Piteå', 'Älvsbyn',
    'Överkalix', 'Övertorneå',
  ]);

  return m;
})();
