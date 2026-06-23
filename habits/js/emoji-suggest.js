// Auto emoji suggestion based on habit name.
// Shows a tappable suggestion absolutely-positioned over the "emoji" label
// when the name matches common keywords. Debounced to avoid twitchiness,
// and zero layout impact since it uses absolute positioning.

const EMOJI_MAP = [
  { words: ['run', 'running', 'jog', 'jogging', 'sprint'], emoji: '🏃' },
  { words: ['walk', 'walking', 'hike', 'hiking', 'stroll', 'amble'], emoji: '🚶' },
  { words: ['gym', 'workout', 'exercise', 'fitness', 'lift', 'weights', 'strength', 'crossfit'], emoji: '🏋️' },
  { words: ['yoga', 'stretch', 'stretching', 'flexibility', 'pilates'], emoji: '🤸' },
  { words: ['swim', 'swimming', 'pool', 'lap', 'laps'], emoji: '🏊' },
  { words: ['bike', 'biking', 'cycle', 'cycling', 'cyclist', 'ride', 'spinning'], emoji: '🚴' },
  { words: ['dance', 'dancing', 'dancer', 'zumba', 'ballet'], emoji: '💃' },
  { words: ['meditate', 'meditation', 'meditating', 'mindful', 'mindfulness'], emoji: '🧘' },
  { words: ['sleep', 'asleep', 'bed', 'rest', 'nap', 'napping', 'siesta'], emoji: '🛌' },
  { words: ['wake', 'waking', 'morning', 'early', 'dawn', 'sunrise'], emoji: '🌅' },
  { words: ['doctor', 'checkup', 'check-up', 'dentist', 'appointment', 'clinic'], emoji: '🏥' },
  { words: ['pill', 'pills', 'medicine', 'medication', 'vitamin', 'vitamins', 'supplement', 'supplements'], emoji: '💊' },
  { words: ['water', 'hydrate', 'hydration', 'drink water'], emoji: '💧' },
  { words: ['weigh', 'weight', 'scale', 'weigh-in'], emoji: '⚖️' },
  { words: ['cook', 'cooking', 'meal prep', 'bake', 'baking', 'baker', 'homemade', 'kitchen'], emoji: '🍳' },
  { words: ['breakfast', 'lunch', 'dinner', 'meal', 'meals', 'eat', 'eating', 'dine', 'dining'], emoji: '🍽️' },
  { words: ['coffee', 'caffeine', 'espresso', 'latte'], emoji: '☕' },
  { words: ['tea', 'chai', 'matcha', 'herbal'], emoji: '🍵' },
  { words: ['soda', 'smoothie', 'juice', 'milkshake'], emoji: '🥤' },
  { words: ['snack', 'snacking', 'junk', 'crisps', 'chips'], emoji: '🍪' },
  { words: ['salad', 'fruit', 'fruits', 'vegetable', 'vegetables', 'veggie', 'veggies', 'greens', 'healthy eat'], emoji: '🥗' },
  { words: ['takeout', 'takeaway', 'delivery', 'fast food', 'fastfood'], emoji: '🥡' },
  { words: ['alcohol', 'beer', 'wine', 'whisky', 'cocktail', 'drinking', 'booze'], emoji: '🍷' },
  { words: ['sugar', 'dessert', 'sweet', 'candy', 'chocolate', 'pastry', 'cake'], emoji: '🍰' },
  { words: ['fast', 'fasting', 'intermittent', 'fasted'], emoji: '⏰' },
  { words: ['read', 'reading', 'reader', 'book', 'books', 'novel', 'page', 'pages'], emoji: '📖' },
  { words: ['study', 'studying', 'learn', 'learning', 'learner', 'course', 'courses', 'class', 'classes', 'lesson'], emoji: '📚' },
  { words: ['write', 'writing', 'writer', 'journal', 'journaling', 'diary'], emoji: '✍️' },
  { words: ['blog', 'blogging', 'blogger', 'post', 'posting'], emoji: '📝' },
  { words: ['school', 'college', 'university', 'homework', 'assignment', 'exam', 'test', 'study group'], emoji: '🎓' },
  { words: ['language', 'spanish', 'french', 'german', 'chinese', 'japanese', 'italian', 'vocabulary', 'words'], emoji: '🗣️' },
  { words: ['news', 'headlines', 'current events', 'article'], emoji: '📰' },
  { words: ['social', 'social media', 'instagram', 'twitter', 'tiktok', 'facebook', 'linkedin', 'scroll'], emoji: '📱' },
  { words: ['phone', 'screen', 'screen time', 'device', 'mobile', 'iphone', 'android'], emoji: '📱' },
  { words: ['tv', 'television', 'netflix', 'stream', 'streaming', 'hulu', 'disney', 'binge'], emoji: '📺' },
  { words: ['movie', 'movies', 'film', 'films', 'cinema', 'theater', 'theatre'], emoji: '🎬' },
  { words: ['game', 'games', 'gaming', 'gamer', 'play', 'video game', 'video games', 'nintendo', 'playstation', 'xbox'], emoji: '🎮' },
  { words: ['youtube', 'video', 'videos', 'creator', 'content'], emoji: '▶️' },
  { words: ['podcast', 'podcasts', 'audio', 'listen', 'listening'], emoji: '🎧' },
  { words: ['music', 'song', 'songs', 'sing', 'singing', 'playlist', 'spotify', 'apple music'], emoji: '🎵' },
  { words: ['work', 'office', 'job', 'working', 'remote', 'commute', 'commuting'], emoji: '💼' },
  { words: ['email', 'emails', 'inbox', 'mail', 'gmail', 'outlook'], emoji: '📧' },
  { words: ['plan', 'planning', 'planner', 'schedule', 'scheduling', 'organize', 'organizing', 'review', 'weekly'], emoji: '📋' },
  { words: ['code', 'coding', 'coder', 'program', 'programming', 'programmer', 'develop', 'developer', 'dev', 'software', 'hack'], emoji: '💻' },
  { words: ['meeting', 'standup', 'sync', 'call', 'zoom', 'teams', 'conference'], emoji: '🤝' },
  { words: ['money', 'finance', 'financial', 'budget', 'budgeting', 'save', 'saving', 'spend', 'spending', 'expense', 'expenses'], emoji: '💵' },
  { words: ['bill', 'bills', 'pay', 'payment', 'invoice', 'subscription'], emoji: '🧾' },
  { words: ['project', 'task', 'tasks', 'todo', 'to-do', 'checklist'], emoji: '✅' },
  { words: ['clean', 'cleaning', 'cleaner', 'tidy', 'tidying', 'declutter', 'decluttering', 'organize'], emoji: '🧹' },
  { words: ['laundry', 'wash', 'washing', 'clothes', 'fold', 'folding', 'iron'], emoji: '👕' },
  { words: ['dishes', 'dish', 'dishwasher'], emoji: '🍽️' },
  { words: ['garden', 'gardening', 'gardener', 'yard', 'lawn', 'plant', 'plants', 'watering', 'prune', 'weed'], emoji: '🌱' },
  { words: ['fix', 'repair', 'maintenance', 'diy', 'handyman', 'tool'], emoji: '🔧' },
  { words: ['skincare', 'skin', 'face', 'moisturize', 'moisturizer', 'serum', 'sunscreen', 'spf'], emoji: '🧴' },
  { words: ['shower', 'bath', 'bathe', 'bathing', 'soak'], emoji: '🚿' },
  { words: ['brush', 'floss', 'flossing', 'teeth', 'tooth', 'dental', 'mouthwash'], emoji: '🪥' },
  { words: ['nail', 'nails', 'manicure', 'pedicure', 'nail care'], emoji: '💅' },
  { words: ['hair', 'haircut', 'barber', 'salon', 'styling', 'hair care'], emoji: '💇' },
  { words: ['gratitude', 'thankful', 'grateful', 'appreciate', 'appreciation', 'thank'], emoji: '🙏' },
  { words: ['family', 'parent', 'parents', 'mom', 'dad', 'mother', 'father', 'sibling', 'siblings', 'brother', 'sister'], emoji: '👨‍👩‍👧‍👦' },
  { words: ['friend', 'friends', 'buddy', 'hang', 'hanging', 'socialize', 'socializing', 'catch up'], emoji: '👥' },
  { words: ['date', 'dating', 'partner', 'spouse', 'relationship', 'romance', 'love'], emoji: '💙' },
  { words: ['call', 'phone call', 'video call', 'facetime', 'skype', 'chat'], emoji: '☎️' },
  { words: ['guitar', 'piano', 'ukulele', 'instrument', 'music practice', 'band', 'rehearsal'], emoji: '🎸' },
  { words: ['art', 'draw', 'drawing', 'sketch', 'sketching', 'paint', 'painting', 'painter', 'watercolor'], emoji: '🎨' },
  { words: ['photo', 'photography', 'photographer', 'camera', 'picture', 'pictures', 'edit photos'], emoji: '📸' },
  { words: ['craft', 'crafting', 'knit', 'knitting', 'sew', 'sewing', 'crochet', 'embroidery', 'pottery'], emoji: '✂️' },
  { words: ['breathe', 'breathing', 'breath', 'deep breath', 'breathe'], emoji: '🌬️' },
  { words: ['affirmation', 'affirmations', 'positive', 'positivity', 'self-love', 'self care'], emoji: '💪' },
  { words: ['therapy', 'therapist', 'counsel', 'counseling', 'mental health'], emoji: '🧠' },
  { words: ['pet', 'pets', 'dog', 'dogs', 'cat', 'cats', 'walk dog', 'walk the dog', 'feed', 'vet'], emoji: '🐾' },
  { words: ['outdoor', 'outside', 'nature', 'park', 'trail', 'forest', 'beach', 'sun'], emoji: '🌳' },
  { words: ['travel', 'trip', 'trips', 'vacation', 'holiday', 'weekend away', 'adventure'], emoji: '🧳' },
  { words: ['save', 'saving', 'piggy', 'bank', 'savings', 'invest', 'investing'], emoji: '💰' },
  { words: ['donate', 'donation', 'charity', 'volunteer', 'volunteering', 'give'], emoji: '❤️' },
  { words: ['quit', 'stop', 'stopping', 'no', 'avoid', 'avoiding', 'without', 'cut out', 'kick'], emoji: '🚫' },
  { words: ['limit', 'reduce', 'reducing', 'less', 'cut', 'cutting', 'down', 'down', 'fewer'], emoji: '⛔' },
  { words: ['smoke', 'smoking', 'smoker', 'cigarette', 'cigarettes', 'vape', 'vaping', 'tobacco', 'nicotine'], emoji: '🚭' },
  { words: ['walk dog', 'walk the dog', 'walk my dog'], emoji: '🐕' },
  { words: ['habit', 'habits', 'routine', 'daily', 'daily routine', 'morning routine', 'evening routine'], emoji: '🎯' },
  { words: ['practice', 'practicing', 'rehearse', 'rehearsal', 'drill', 'training'], emoji: '🔄' },
  { words: ['goal', 'goals', 'target', 'milestone', 'objective'], emoji: '🎯' },
  { words: ['time', 'timer', 'pomodoro', 'focus', 'deep work', 'productivity'], emoji: '⏳' },
  { words: ['no', 'none', 'zero', 'never'], emoji: '🚫' },
  // home & family
  { words: ['groceries', 'grocery', 'grocery shopping', 'groceries list', 'shopping list'], emoji: '🛒' },
  { words: ['baby', 'babies', 'infant', 'newborn', 'toddler'], emoji: '👶' },
  { words: ['bottle', 'breastfeed', 'breastfeeding', 'pump', 'baby feed'], emoji: '🍼' },
  { words: ['diaper', 'diapers', 'potty', 'potty training', 'nappy'], emoji: '👶' },
  { words: ['playdate', 'playground', 'park with kids'], emoji: '🧸' },
  { words: ['toys', 'pick up toys', 'tidy toys', 'organize toys'], emoji: '🧸' },
  { words: ['school run', 'drop off', 'pick up kids', 'school pick up', 'carpool'], emoji: '🚗' },
  { words: ['bedtime', 'bedtime routine', 'put kids to bed', 'story time', 'lullaby'], emoji: '🌙' },
  { words: ['home management', 'home manager', 'household', 'household tasks'], emoji: '🏠' },
  { words: ['errand', 'errands', 'run errands', 'chores', 'house chores'], emoji: '📋' },
  { words: ['vacuum', 'vacuuming', 'mop', 'mopping', 'sweep', 'sweeping', 'dust', 'dusting', 'deep clean'], emoji: '🧹' },
  { words: ['meal plan', 'meal planning', 'menu plan', 'weekly menu'], emoji: '📝' },
  { words: ['lunch prep', 'lunchbox', 'snack prep', 'pack lunch'], emoji: '🍱' },
  { words: ['bath time', 'bath kids', 'bathe kids'], emoji: '🛁' },
  { words: ['pediatrician', 'well check', 'wellness check', 'child doctor'], emoji: '🩺' },
  { words: ['birthday', 'birthday party', 'party planning', 'celebration'], emoji: '🎂' },
  { words: ['homework help', 'help with homework', 'tutor kids', 'help kids study'], emoji: '📚' },
  { words: ['sick kid', 'sick child', 'kid home sick', 'child sick'], emoji: '🤒' },
  { words: ['mom time', 'me time', 'self care mom', 'break'], emoji: '🧘' },
  // students
  { words: ['attend class', 'go to class', 'lecture', 'lectures', 'lecture hall', 'seminar'], emoji: '🏫' },
  { words: ['notes', 'note taking', 'lecture notes', 'class notes', 'study notes'], emoji: '📓' },
  { words: ['science', 'biology', 'chemistry', 'physics', 'lab', 'laboratory', 'experiment'], emoji: '🔬' },
  { words: ['math', 'mathematics', 'algebra', 'calculus', 'geometry', 'trigonometry', 'statistics'], emoji: '📐' },
  { words: ['history', 'geography', 'civics', 'social studies'], emoji: '🌍' },
  { words: ['english', 'literature', 'poetry', 'essay', 'essays', 'paper', 'research paper'], emoji: '📝' },
  { words: ['presentation', 'present', 'presenting', 'speech', 'public speaking', 'oral'], emoji: '🎤' },
  { words: ['flashcard', 'flashcards', 'quiz', 'quiz yourself', 'self test'], emoji: '🗂️' },
  { words: ['revision', 'revise', 'review session', 'cram', 'cramming', 'study session'], emoji: '📖' },
  { words: ['deadline', 'due date', 'submission', 'submit', 'turn in', 'due tomorrow'], emoji: '⏰' },
  { words: ['research', 'researching', 'thesis', 'dissertation', 'capstone'], emoji: '🔍' },
  { words: ['library', 'study at library', 'library session'], emoji: '📚' },
  { words: ['semester', 'term', 'quarter', 'academic year'], emoji: '📅' },
  { words: ['syllabus', 'curriculum', 'course outline'], emoji: '📋' },
  { words: ['grade', 'grades', 'gpa', 'report card', 'transcript'], emoji: '📊' },
  { words: ['tutor', 'tutoring', 'tutoring session', 'study group', 'group study'], emoji: '👨‍🏫' },
  { words: ['extracurricular', 'club', 'student club', 'after school'], emoji: '🎭' },
  { words: ['scholarship', 'scholarship application', 'financial aid'], emoji: '🎓' },
  { words: ['internship', 'intern', 'co-op', 'work term'], emoji: '💼' },
  // professionals
  { words: ['networking', 'network', 'professional network', 'connect'], emoji: '🤝' },
  { words: ['resume', 'cv', 'cover letter', 'job application', 'apply'], emoji: '📄' },
  { words: ['interview', 'job interview', 'phone screen'], emoji: '🤝' },
  { words: ['client', 'clients', 'customer', 'customers', 'account'], emoji: '🤝' },
  { words: ['slide', 'slides', 'deck', 'slide deck', 'powerpoint', 'keynote'], emoji: '📽️' },
  { words: ['report', 'reports', 'status report', 'weekly report', 'monthly report'], emoji: '📊' },
  { words: ['performance review', 'annual review', 'quarterly review', 'feedback'], emoji: '📋' },
  { words: ['conference', 'summit', 'convention', 'networking event'], emoji: '🎤' },
  { words: ['workshop', 'workshops', 'seminar', 'training session', 'professional development'], emoji: '🛠️' },
  { words: ['certification', 'cert', 'certificate', 'certification exam'], emoji: '📜' },
  { words: ['promotion', 'promoted', 'career growth', 'advancement'], emoji: '📈' },
  { words: ['onboarding', 'new hire', 'orientation', 'ramp up'], emoji: '👋' },
  { words: ['brainstorm', 'brainstorming', 'ideation', 'creative session'], emoji: '💡' },
  { words: ['collaborate', 'collaboration', 'teamwork', 'cross-team'], emoji: '🤝' },
  { words: ['freelance', 'freelancer', 'freelancing', 'contractor', 'gig'], emoji: '👨‍💻' },
  { words: ['contract', 'contracts', 'proposal', 'proposals', 'scope'], emoji: '📝' },
  { words: ['portfolio', 'portfolio site', 'case study', 'work sample'], emoji: '📁' },
  { words: ['side project', 'side hustle', 'passion project', 'solo project'], emoji: '🚀' },
  { words: ['sprint', 'sprint planning', 'retro', 'retrospective', 'sprint review', 'standup', 'daily standup', 'scrum'], emoji: '🔄' },
  { words: ['kpi', 'okr', 'metrics', 'metric', 'dashboard', 'analytics'], emoji: '📊' },
  { words: ['remote', 'wfh', 'work from home', 'home office', 'remote work'], emoji: '🏠' },
  { words: ['leadership', 'lead', 'team lead', 'manager', 'management', 'director'], emoji: '👑' },
  { words: ['mentor', 'mentoring', 'mentorship', 'coach', 'coaching'], emoji: '👨‍🏫' },
  { words: ['newsletter', 'newsletters', 'digest', 'mailing list'], emoji: '📰' },
  { words: ['business trip', 'work trip', 'corporate travel', 'offsite'], emoji: '✈️' },
  { words: ['payroll', 'salary', 'compensation', 'bonus', 'raise'], emoji: '💵' },
  { words: ['pto', 'vacation days', 'time off', 'paid time off'], emoji: '🌴' },
  { words: ['sick day', 'mental health day', 'call out'], emoji: '🤒' },
  { words: ['invoice', 'invoicing', 'send invoice', 'client bill'], emoji: '🧾' },
  { words: ['expense', 'expenses', 'expense report', 'reimbursement'], emoji: '💰' },
  { words: ['compliance', 'regulation', 'audit', 'policy', 'security training'], emoji: '✅' },
  // general wellness & misc
  { words: ['back pain', 'neck pain', 'stretch break', 'ergonomics', 'posture'], emoji: '🦴' },
  { words: ['eye strain', 'eye rest', 'screen break', 'look away', '20-20-20'], emoji: '👁️' },
  { words: ['step', 'steps', 'step count', 'step goal', 'standing', 'stand'], emoji: '👟' },
  { words: ['period', 'menstrual', 'cramps', 'cycle'], emoji: '🩸' },
  { words: ['headache', 'migraine', 'head pain'], emoji: '🤕' },
  { words: ['smoothie', 'green smoothie', 'protein shake'], emoji: '🥤' },
  { words: ['sugar free', 'no sugar', 'cut sugar', 'low sugar', 'healthy snack'], emoji: '🥗' },
  { words: ['fast food', 'junk food', 'no junk', 'cut junk', 'healthy choice'], emoji: '🥗' },
  { words: ['vegan', 'vegetarian', 'plant based', 'dairy free', 'gluten free'], emoji: '🥬' },
  { words: ['prep', 'prepping', 'get ready', 'ready'], emoji: '✅' },
  { words: ['evening', 'night', 'nighttime', 'night routine'], emoji: '🌙' },
  { words: ['afternoon', 'midday', 'noon'], emoji: '☀️' },
];

let _suggestTimer = null;
let _currentSuggestion = null;

function _suggestionEl() {
  return document.getElementById('emoji-suggestion');
}

function findEmojiMatch(name) {
  if (!name || !name.trim()) return null;
  const lower = name.toLowerCase().trim();
  const words = lower.split(/\s+/).filter(Boolean);

  let bestScore = 0;
  let bestEmoji = null;

  for (const entry of EMOJI_MAP) {
    for (const keyword of entry.words) {
      const kw = keyword.toLowerCase();
      const isMulti = kw.includes(' ');
      let matched = false;

      if (isMulti) {
        if (lower.includes(kw)) matched = true;
      } else {
        matched = words.some(w => w === kw || w.startsWith(kw));
      }

      if (matched) {
        if (kw.length > bestScore) {
          bestScore = kw.length;
          bestEmoji = entry.emoji;
        }
      }
    }
  }

  return bestEmoji;
}

function _hideSuggestion() {
  const el = _suggestionEl();
  if (el) el.hidden = true;
  _currentSuggestion = null;
}

function _showSuggestion(emoji) {
  const el = _suggestionEl();
  if (!el) return;
  el.textContent = 'tap to use ' + emoji;
  el.hidden = false;
  _currentSuggestion = emoji;
}

function _acceptSuggestion() {
  const el = _suggestionEl();
  if (!el || el.hidden || !_currentSuggestion) return;
  const ef = document.getElementById('ting-emoji');
  if (!ef) return;
  ef.value = _currentSuggestion;
  _hideSuggestion();
  ef.dispatchEvent(new Event('input', { bubbles: true }));
  ef.focus({ preventScroll: true });
}

function _onNameInput() {
  clearTimeout(_suggestTimer);
  _suggestTimer = setTimeout(() => {
    const ef = document.getElementById('ting-emoji');
    if (!ef) return;
    if (ef.value.trim()) {
      _hideSuggestion();
      return;
    }
    const match = findEmojiMatch(document.getElementById('ting-message').value);
    if (match) {
      const el = _suggestionEl();
      if (el && (el.hidden || el.textContent !== ('tap to use ' + match))) {
        _showSuggestion(match);
      }
    } else {
      _hideSuggestion();
    }
  }, 350);
}

function setupEmojiSuggestion() {
  const nameInput = document.getElementById('ting-message');
  const el = _suggestionEl();
  const ef = document.getElementById('ting-emoji');
  if (!nameInput || !el || !ef) return;

  nameInput.addEventListener('input', _onNameInput);

  el.addEventListener('pointerdown', e => {
    e.preventDefault();
    _acceptSuggestion();
  });
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      _acceptSuggestion();
    }
  });

  ef.addEventListener('input', _hideSuggestion);
  ef.addEventListener('focus', () => {
    if (ef.value.trim()) _hideSuggestion();
  });
}

function clearEmojiSuggestion() {
  clearTimeout(_suggestTimer);
  _hideSuggestion();
}

setupEmojiSuggestion();
