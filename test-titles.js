/**
 * Test script to show Jikan API title variations
 * Run with: node test-titles.js
 */

const https = require('https');

// Example anime with different title structures
const testAnime = [
  { id: 16498, name: 'Attack on Titan S1' },
  { id: 5114, name: 'Fullmetal Alchemist: Brotherhood' },
  { id: 20, name: 'Naruto' },
  { id: 11757, name: 'Sword Art Online' },
  { id: 1535, name: 'Death Note' },
  { id: 9253, name: 'Steins;Gate' },
  { id: 1, name: 'Cowboy Bebop' },
];

function fetchAnime(malId) {
  return new Promise((resolve, reject) => {
    const url = `https://api.jikan.moe/v4/anime/${malId}`;

    https.get(url, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.data);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

function analyzeTitle(anime, preference = 'romaji') {
  const titles = anime.titles || [];
  const defaultTitle = titles.find(t => t.type === 'Default');
  const englishTitle = titles.find(t => t.type === 'English');
  const japaneseTitle = titles.find(t => t.type === 'Japanese');
  const synonyms = titles.filter(t => t.type === 'Synonym');

  console.log(`\n${'='.repeat(70)}`);
  console.log(`${anime.title} (MAL ID: ${anime.mal_id})`);
  console.log('='.repeat(70));

  console.log('\n📋 Available Titles:');
  console.log(`  Default:  "${defaultTitle?.title || 'N/A'}"`);
  console.log(`  English:  "${englishTitle?.title || 'N/A'}"`);
  console.log(`  Japanese: "${japaneseTitle?.title || 'N/A'}"`);
  if (synonyms.length > 0) {
    console.log(`  Synonyms: ${synonyms.map(s => `"${s.title}"`).join(', ')}`);
  }

  console.log('\n🔍 Analysis:');
  const defaultEqualsEnglish = defaultTitle?.title === englishTitle?.title;
  console.log(`  Default == English? ${defaultEqualsEnglish ? '✅ YES' : '❌ NO'}`);

  if (defaultEqualsEnglish) {
    console.log(`  → MAL uses English as the default title`);
  } else {
    console.log(`  → MAL uses romaji/native as the default title`);
  }

  // Simulate our mapper logic for romaji preference
  // Simple: always use Default title
  const selectedTitle = defaultTitle?.title || englishTitle?.title || 'N/A';
  console.log(`\n✨ Selected for romaji: "${selectedTitle}"`);
  console.log(`   (Always uses Default title from MAL)`);

  if (defaultEqualsEnglish) {
    console.log(`   Note: MAL's default is English for this anime`);
  } else {
    console.log(`   Note: MAL's default is romaji/native title`);
  }

  console.log(`\n💡 Synonyms available for matching: ${synonyms.length > 0 ? synonyms.map(s => `"${s.title}"`).join(', ') : 'None'}`);

  return selectedTitle;
}

async function runTests() {
  console.log('🎌 Jikan API Title Analysis Test');
  console.log('Testing how different anime store their titles in MAL/Jikan\n');

  for (const anime of testAnime) {
    try {
      console.log(`\nFetching: ${anime.name}...`);
      const data = await fetchAnime(anime.id);
      analyzeTitle(data);

      // Rate limiting - wait 1 second between requests
      if (testAnime.indexOf(anime) < testAnime.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.error(`❌ Error fetching ${anime.name}:`, error.message);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('📊 Summary:');
  console.log('='.repeat(70));
  console.log(`
As you can see:
- Some anime use English as Default (FMA:B, SAO, Naruto, etc.)
- Some anime use romaji as Default (Attack on Titan → "Shingeki no Kyojin")
- MAL decides what the "Default" title is (not always romaji!)

Our mapper for romaji preference:
✅ Always uses the Default title from MAL
✅ Synonyms are ONLY used for matching, not display
✅ Simple and consistent - you get MAL's official title

When you set TITLE_LANGUAGE=romaji, you get MAL's default title.
When you set TITLE_LANGUAGE=english, you get the English title.
  `);
}

runTests().catch(console.error);
