// Auto emoji suggestion based on habit name.
// Exact keyword match first (multi-word phrases are most specific), then a
// high-confidence fuzzy pass for misspelled keywords, then the user's own
// pick from a generic quick-pick row — so nobody is ever stuck without an
// emoji. Debounced to avoid twitchiness. Fuzzy matching is bucketed by word
// length and bails out early, so it stays cheap even with a big keyword map.

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
  { words: ['breathe', 'breathing', 'breath', 'deep breath'], emoji: '🌬️' },
  { words: ['affirmation', 'affirmations', 'positive', 'positivity', 'self-love', 'self care'], emoji: '💪' },
  { words: ['therapy', 'therapist', 'counsel', 'counseling', 'mental health'], emoji: '🧠' },
  { words: ['pet', 'pets', 'dog', 'dogs', 'cat', 'cats', 'walk dog', 'walk the dog', 'feed', 'vet'], emoji: '🐾' },
  { words: ['outdoor', 'outside', 'nature', 'park', 'trail', 'forest', 'beach', 'sun'], emoji: '🌳' },
  { words: ['travel', 'trip', 'trips', 'vacation', 'holiday', 'weekend away', 'adventure'], emoji: '🧳' },
  { words: ['save', 'saving', 'piggy', 'bank', 'savings', 'invest', 'investing'], emoji: '💰' },
  { words: ['donate', 'donation', 'charity', 'volunteer', 'volunteering', 'give'], emoji: '❤️' },
  { words: ['quit', 'stop', 'stopping', 'no', 'avoid', 'avoiding', 'without', 'cut out', 'kick'], emoji: '🚫' },
  { words: ['limit', 'reduce', 'reducing', 'less', 'cut', 'cutting', 'down', 'fewer'], emoji: '⛔' },
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
  // faith & deen (the app already ships prayer-time anchors)
  { words: ['pray','prayer','salah','salat','namaz','islam','muslim','deen','faith','religion','ibadah','worship','church','mosque'], emoji: '🕌' },
  { words: ['quran',"qur'an",'koran','tilawah','tajweed','memorize quran','read quran'], emoji: '📖' },
  { words: ['dua','duaa','dhikr','dikr','adhkar','tasbih','istighfar','remembrance of god'], emoji: '🤲' },
  { words: ['ramadan','ramadhan','sawm','iftar','suhoor','sehri'], emoji: '🌙' },
  { words: ['sadaqah','zakat','charity','donate','donating','giving','philanthropy','fundraise'], emoji: '🤝' },
  // extra wellness & life
  { words: ['cold shower','cold plunge','ice bath','cryotherapy','cryo'], emoji: '🧊' },
  { words: ['sunlight','sun exposure','vitamin d','daylight','morning light'], emoji: '☀️' },
  { words: ['breathwork','wim hof','box breathing','pranayama','breathing exercise'], emoji: '🌬️' },
  { words: ['standing desk','stand more','upright'], emoji: '🧍' },
  { words: ['posture','sit up straight','ergonomic','ergonomics'], emoji: '🪑' },
  { words: ['journal','journaling','morning pages','brain dump','reflect','reflection','diary entry'], emoji: '📓' },
  { words: ['inbound','inbox zero','triage','clear inbox','process email','empty inbox'], emoji: '📥' },
  { words: ['learn','learning','skill building','deliberate practice','upskill','self improvement'], emoji: '🧠' },
  // sports & fitness
  { words: ['tennis','racket','racquet','serve practice'], emoji: '🎾' },
  { words: ['basketball','basket','hoops','basketball practice'], emoji: '🏀' },
  { words: ['football','soccer','futsal','football practice'], emoji: '⚽' },
  { words: ['american football','nfl','super bowl'], emoji: '🏈' },
  { words: ['golf','golfing','putting','putt','driving range'], emoji: '⛳' },
  { words: ['boxing','boxer','sparring','kickbox','kickboxing'], emoji: '🥊' },
  { words: ['martial arts','karate','taekwondo','judo','jiu jitsu','bjj','kung fu','muay thai','aikido'], emoji: '🥋' },
  { words: ['cricket','batting'], emoji: '🏏' },
  { words: ['table tennis','ping pong','pingpong'], emoji: '🏓' },
  { words: ['volleyball','beach volleyball'], emoji: '🏐' },
  { words: ['baseball','softball'], emoji: '⚾' },
  { words: ['hockey','ice hockey','hockey practice'], emoji: '🏒' },
  { words: ['badminton','shuttlecock'], emoji: '🏸' },
  { words: ['climb','climbing','bouldering','rock climbing','indoor climbing'], emoji: '🧗' },
  { words: ['rowing','row machine','erg','kayak','kayaking','canoe','canoeing'], emoji: '🚣' },
  { words: ['skiing','ski trip','ski lesson','snowboard','snowboarding'], emoji: '⛷️' },
  { words: ['surf','surfing','surf lesson','wakeboard'], emoji: '🏄' },
  { words: ['skate','skating','skateboard','skateboarding','longboard'], emoji: '🛹' },
  { words: ['ice skate','ice skating'], emoji: '⛸️' },
  { words: ['jump rope','skipping','skipping rope'], emoji: '🤸' },
  { words: ['fishing','angling','fish practice'], emoji: '🎣' },
  { words: ['bowling','tenpin','ten pin bowling','bowling night'], emoji: '🎳' },
  { words: ['cardio','aerobics','hiit','burpee','burpees','pushup','pushups','push up','push ups','pullup','pullups','pull up','pull ups','chin up','chin ups','situp','situps','sit up','plank','planks','squat','squats','lunge','lunges','deadlift','bench press','dumbbell','dumbbells','kettlebell','resistance','resistance band','treadmill','elliptical'], emoji: '🏋️' },
  { words: ['physio','physiotherapy','physical therapy','rehab','rehabilitation','sports therapy'], emoji: '🩺' },
  // body & grooming
  { words: ['shave','shaving','shaver'], emoji: '🪒' },
  { words: ['makeup','make up','cosmetics','lipstick','foundation'], emoji: '💄' },
  { words: ['perfume','cologne','deodorant','fragrance','body spray'], emoji: '🧴' },
  // food & drink
  { words: ['egg','eggs','omelette','omelet','scrambled eggs','boiled egg'], emoji: '🥚' },
  { words: ['bread','toast','bagel','croissant','sandwich','sandwiches'], emoji: '🍞' },
  { words: ['cheese','cheeseboard','cheese night'], emoji: '🧀' },
  { words: ['soup','stew','chili','curry','hotpot'], emoji: '🍲' },
  { words: ['pasta','noodles','spaghetti','ramen','pho','carbonara'], emoji: '🍝' },
  { words: ['rice','risotto','fried rice'], emoji: '🍚' },
  { words: ['sushi','sashimi','sushi night'], emoji: '🍣' },
  { words: ['pizza','pizza night'], emoji: '🍕' },
  { words: ['burger','hamburger','burger night'], emoji: '🍔' },
  { words: ['fries','french fries','hash browns'], emoji: '🍟' },
  { words: ['ice cream','gelato','frozen yogurt','froyo'], emoji: '🍦' },
  { words: ['bbq','barbecue','grill','grilling','steak','meat','beef','chicken','turkey','lamb','protein','steak night'], emoji: '🍖' },
  { words: ['fish','salmon','tuna','seafood','shrimp','prawns'], emoji: '🐟' },
  { words: ['honey','honey pot'], emoji: '🍯' },
  { words: ['eat out','eating out','restaurant','restaurants','eat at restaurant'], emoji: '🍽️' },
  // home & chores
  { words: ['trash','garbage','take out trash','rubbish','recycling','recycle','recycling bin'], emoji: '🗑️' },
  { words: ['make the bed','make bed','change sheets','bedding'], emoji: '🛏️' },
  { words: ['closet','wardrobe','organize closet','capsule wardrobe'], emoji: '🧺' },
  { words: ['filing','file papers','paperwork','organize papers','documents','sort mail','declutter papers'], emoji: '📂' },
  { words: ['car wash','wash car','detail car','car detailing'], emoji: '🚗' },
  { words: ['oil change','gas','gas station','fill gas','petrol','fuel','tire pressure','tyre pressure'], emoji: '⛽' },
  { words: ['shopping','clothes shopping','window shopping','mall','mall trip'], emoji: '🛍️' },
  { words: ['package','packages','parcel','amazon','ship','shipping','return package','returns','pick up package'], emoji: '📦' },
  { words: ['wifi','router','internet','mesh','wifi setup'], emoji: '📡' },
  { words: ['thermostat','air filter','furnace filter','heating filter','ac filter','filter'], emoji: '🌡️' },
  { words: ['battery','batteries','charge','charging','charger','replace batteries'], emoji: '🔋' },
  { words: ['backup','backups','back up','cloud backup','icloud','google photos'], emoji: '☁️' },
  { words: ['locksmith','lock','locks','keys','spare key','new lock'], emoji: '🔑' },
  { words: ['insurance','renew insurance','car insurance','health insurance','home insurance'], emoji: '🛡️' },
  { words: ['license','licence','renew license','renew licence','registration','id renewal'], emoji: '🪪' },
  { words: ['visa','passport','renew passport','visa run','passport application'], emoji: '🛂' },
  { words: ['taxes','tax','file taxes','tax return','tax filing'], emoji: '🧾' },
  { words: ['smoke detector','carbon monoxide','alarm test','alarm battery'], emoji: '🔔' },
  { words: ['lightbulb','light bulbs','bulb','led bulbs'], emoji: '💡' },
  { words: ['house cleaning service','cleaning service'], emoji: '🧹' },
  // learning & hobbies
  { words: ['chess','chess puzzle','chess practice'], emoji: '♟️' },
  { words: ['puzzle','puzzles','jigsaw','crossword','sudoku','jigsaw puzzle'], emoji: '🧩' },
  { words: ['typing','touch typing','typing practice','keyboard'], emoji: '⌨️' },
  { words: ['drums','drumming','violin','viola','cello','flute','saxophone','trumpet','clarinet','harmonica','orchestra'], emoji: '🎻' },
  { words: ['compose','composing','music theory','ear training','produce music','producing','beat making'], emoji: '🎼' },
  { words: ['video edit','editing','edit video','montage','video editing'], emoji: '🎞️' },
  { words: ['design','designing','graphic design','ui design','figma','logo','poster','branding'], emoji: '🖌️' },
  { words: ['woodworking','carpentry','wood work'], emoji: '🪚' },
  { words: ['ceramics','ceramic class','hand building'], emoji: '🏺' },
  // faith (already ships prayer-time anchors — a few more names)
  { words: ['masjid','jummah','jumuah','congregational prayer','taraweeh','tahajjud','qiyam','itikaf'], emoji: '🕌' },
  { words: ['seerah','hadith','hadith study','islamic study','tazkiyah','islamic course'], emoji: '📖' },
  // health
  { words: ['blood pressure','bp check','blood test','bloodwork','lab work','blood work','test results'], emoji: '🩺' },
  { words: ['vaccine','vaccination','booster','flu shot','immunization'], emoji: '💉' },
  { words: ['eye exam','optometrist','eye check','vision test'], emoji: '👁️' },
  { words: ['massage','massaging','self massage','foam roll','foam rolling','neck massage'], emoji: '💆' },
  { words: ['sauna','steam room','hot tub','jacuzzi','sauna session'], emoji: '🧖' },
  // screen & tech
  { words: ['doomscroll','doom scrolling','reels','shorts','for you'], emoji: '📱' },
  { words: ['debug','debugging','bug','bugs','troubleshoot','troubleshooting'], emoji: '🐛' },
  { words: ['github','git commit','pull request','open source','pr review','code review'], emoji: '🐙' },
  { words: ['website','web dev','web development','wordpress','landing page','seo'], emoji: '🌐' },
  { words: ['server','deploy','deployment','docker','aws','devops','infrastructure'], emoji: '🖥️' },
  { words: ['database','sql','data modeling','query'], emoji: '🗄️' },
  { words: ['excel','google sheets','spreadsheet','spreadsheets','sheets'], emoji: '📊' },
  { words: ['documentation','docs','readme','technical writing'], emoji: '📄' },
  { words: ['message','messages','text','texting','whatsapp','telegram','signal','imessage','sms'], emoji: '💬' },
  { words: ['voice note','voice notes','voice memo','dictation','transcribe'], emoji: '🎙️' },
  // money
  { words: ['net worth','rebalance','portfolio review','rebalancing'], emoji: '📈' },
  { words: ['stocks','stock market','trading','crypto','bitcoin','cryptocurrency','day trading'], emoji: '💹' },
  { words: ['coupon','coupons','discount','cashback','deal','deals'], emoji: '🏷️' },
  { words: ['emergency fund','sinking fund','rainy day fund'], emoji: '💰' },
  // travel
  { words: ['packing','pack bag','pack bags','pack suitcase','suitcase'], emoji: '🧳' },
  { words: ['flight','flights','boarding pass','check in flight','airport'], emoji: '✈️' },
  { words: ['hotel','hotel booking','reservation','itinerary','airbnb'], emoji: '🏨' },
  { words: ['road trip','roadtrip','road trip planning'], emoji: '🚗' },
  { words: ['map','maps','route','navigation','directions'], emoji: '🗺️' },
  // social & life
  { words: ['gift','gifts','gift wrap','gift buying','gift card'], emoji: '🎁' },
  { words: ['wedding','anniversary','engagement'], emoji: '💍' },
  { words: ['party','parties','host','hosting','get together','gathering'], emoji: '🎉' },
  { words: ['farewell','send off','goodbye'], emoji: '👋' },
  { words: ['hospital','urgent care','er visit','hospital visit'], emoji: '🏥' },
  { words: ['apologize','apology','forgive','forgiveness','make amends'], emoji: '🕊️' },
  { words: ['call mom','call dad','call parents','call grandma','call grandpa','call family'], emoji: '☎️' },
  // work & time
  { words: ['timesheet','time tracking','clock in','clock out','punch in'], emoji: '🕰️' },
  { words: ['plan tomorrow','plan next day','evening review','end of day review','plan next week'], emoji: '📋' },
  // weather & misc
  { words: ['umbrella','rain','rainy'], emoji: '☔' },
  { words: ['snow','shovel snow','snow shovel','winter gear'], emoji: '❄️' },
  { words: ['vision board','mood board','collage'], emoji: '🖼️' },
  { words: ['early night','early to bed'], emoji: '🌙' },
  { words: ['delete instagram','delete social media','delete apps','delete app','delete tiktok'], emoji: '🚫' },
  // abstract — unicode symbols where no object emoji fits
  { words: ['resolution','resolutions','intention','intentions','resolve','mindset'], emoji: '⭐' },
  { words: ['audit','check in','check-in','evaluate','assess','scorecard','measure'], emoji: '🔎' },
  { words: ['minimize','minimise','curb','cut back','cutback','moderate'], emoji: '⛔' },
];

let _suggestTimer = null;
let _detailSuggestTimer = null;
let _emojiUserEdited = false;
let _detailEmojiUserEdited = false;
let _detailEmojiAtOpen = '';

// Words that usually modify an activity (time of day, frequency). These only
// win when nothing more specific matches, so "morning run" -> 🏃 not 🌅.
const _MODIFIER_WORDS = new Set(['morning','evening','night','nighttime','afternoon','midday','noon','dawn','sunrise','sunset','early','wake','waking','today','tonight','tomorrow','daily','weekly','monthly']);

// Generic emojis shown as tappable chips under the emoji field so a habit is
// never left without an emoji — even when the name matches nothing at all.
// Deliberately neutral: none of these are used by any keyword mapping, so the
// row never duplicates or fights an auto-suggested emoji.
const GENERIC_EMOJIS = ['🔥','🌟','📌','🏆','✨','💫','🌈','🍀','⚡','🌻','🦋','🌊','🌸','🧿','🎈','🏵️','🪐','🥇'];

// Fuzzy index: single-word keywords bucketed by length so a misspelled word
// only ever compares against keywords of a similar size. Built once at load.
const _WORD_BY_LEN = new Map();
(function buildFuzzyIndex(){
  for(const entry of EMOJI_MAP){
    for(const raw of entry.words){
      const kw = raw.toLowerCase().trim();
      if(kw.includes(' ') || kw.length < 4 || !/^[\p{L}\p{N}]+$/u.test(kw))continue;
      let bucket = _WORD_BY_LEN.get(kw.length);
      if(!bucket){bucket = [];_WORD_BY_LEN.set(kw.length,bucket);}
      bucket.push({kw,emoji:entry.emoji,modifier:_MODIFIER_WORDS.has(kw)});
    }
  }
})();

// Strip punctuation off the ends of a word ("run!" -> "run") so trailing
// !,?.,: never break a match. Internal hyphens like "check-up" are kept.
function _normalizeWord(w){
  return w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu,'');
}

// Levenshtein distance with an early bail-out at maxDist — the common case
// (distance too big) exits after the first row that can no longer recover.
function _editDistance(a,b,maxDist){
  if(a === b)return 0;
  const aLen = a.length, bLen = b.length;
  if(aLen === 0)return bLen;
  if(bLen === 0)return aLen;
  if(aLen - bLen > maxDist || bLen - aLen > maxDist)return Infinity;
  let prev = new Array(bLen + 1);
  let cur = new Array(bLen + 1);
  for(let j = 0; j <= bLen; j++)prev[j] = j;
  for(let i = 1; i <= aLen; i++){
    cur[0] = i;
    let rowMin = i;
    const ai = a.charCodeAt(i - 1);
    for(let j = 1; j <= bLen; j++){
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
      let v = prev[j] + 1;
      const d1 = cur[j - 1] + 1;
      if(d1 < v)v = d1;
      const d2 = prev[j - 1] + cost;
      if(d2 < v)v = d2;
      cur[j] = v;
      if(v < rowMin)rowMin = v;
    }
    if(rowMin > maxDist)return Infinity;
    const t = prev; prev = cur; cur = t;
  }
  return prev[bLen];
}

// High-confidence fuzzy match for one misspelled word. Only accepts close
// edits (distance 1; 2 for long words) against keywords of nearly the same
// length, and rejects ties between different emojis as too ambiguous. This
// deliberately never guesses widely — unknown words just fall through.
function _fuzzyEmojiFor(word){
  const len = word.length;
  if(len < 4 || len > 16 || /^\p{N}+$/u.test(word))return null;
  const maxDist = len >= 8 ? 2 : 1;
  let best = null;          // {emoji, dist, modifier}
  let tieEmojis = null;
  for(let dl = -1; dl <= 1; dl++){
    const bucket = _WORD_BY_LEN.get(len + dl);
    if(!bucket)continue;
    for(const cand of bucket){
      const dist = _editDistance(word, cand.kw, maxDist);
      if(dist < 1 || dist > maxDist)continue;
      if(!best || dist < best.dist || (dist === best.dist && !cand.modifier && best.modifier)){
        best = {emoji:cand.emoji,dist,modifier:cand.modifier};
        tieEmojis = new Set([cand.emoji]);
      }else if(dist === best.dist && !(cand.modifier && !best.modifier)){
        tieEmojis.add(cand.emoji);
      }
    }
  }
  if(!best || (tieEmojis && tieEmojis.size > 1))return null;
  return best;
}

// Best fuzzy match across all words. Prefers non-modifier keywords (so
// "moring excersise" -> 🏋️, not 🌅), then the closest edit, then word order.
function _fuzzyEmoji(words){
  let best = null;
  for(const w of words){
    const cand = _fuzzyEmojiFor(w);
    if(!cand)continue;
    const candKey = cand.modifier ? 1 : 0;
    const bestKey = best ? (best.modifier ? 1 : 0) : 2;
    if(!best || candKey < bestKey || (candKey === bestKey && cand.dist < best.dist)){
      best = cand;
    }
  }
  return best ? best.emoji : null;
}

function findEmojiMatch(name){
  if(!name || !name.trim())return null;
  const lower = name.toLowerCase().trim();
  const words = lower.split(/\s+/).filter(Boolean);
  const normWords = words.map(_normalizeWord).filter(Boolean);
  let bestPhrase = null;   // multi-word phrase (most specific)
  let bestStrong = null;   // single non-modifier keyword
  let bestWeak = null;     // single modifier keyword
  for(const entry of EMOJI_MAP){
    for(const keyword of entry.words){
      const kw = keyword.toLowerCase();
      if(kw.includes(' ')){
        if(lower.includes(kw) && (!bestPhrase || kw.length > bestPhrase.len))bestPhrase = {emoji:entry.emoji,len:kw.length};
        continue;
      }
      const matched = normWords.some(w => w === kw || w.startsWith(kw));
      if(!matched)continue;
      if(_MODIFIER_WORDS.has(kw)){
        if(!bestWeak || kw.length > bestWeak.len)bestWeak = {emoji:entry.emoji,len:kw.length};
      }else{
        if(!bestStrong || kw.length > bestStrong.len)bestStrong = {emoji:entry.emoji,len:kw.length};
      }
    }
  }
  if(bestPhrase)return bestPhrase.emoji;
  if(bestStrong)return bestStrong.emoji;
  const fuzzy = _fuzzyEmoji(normWords);
  if(fuzzy)return fuzzy;
  if(bestWeak)return bestWeak.emoji;
  return null;
}

// PURE: pick a background color that keeps the (emoji + color) pair unique
// across existing habits. The first user of an emoji gets no color; a later
// collision is disambiguated with the first unused palette color.
function pickUniqueColor(emoji){
  if(!emoji)return '';
  const habits = typeof load === 'function' ? load() : [];
  const occupied = new Set();
  for(const h of habits){
    if(h && (h.emoji || '') === emoji)occupied.add(h.emojiBgColor || '');
  }
  if(occupied.size === 0)return '';
  const tokens = typeof EMOJI_BG_COLOR_TOKENS !== 'undefined' ? EMOJI_BG_COLOR_TOKENS : [];
  const candidates = ['', ...tokens];
  for(const c of candidates){
    if(!occupied.has(c))return c;
  }
  return '';
}

// RENDER: reflect current emoji + selected color (or the type's default icon
// when blank) in the add-sheet preview tile — exactly what the home tile shows.
function updateEmojiPreview(){
  syncGenericEmojiRows();
  const preview = document.getElementById('ting-emoji-preview');
  if(!preview)return;
  const emoji = document.getElementById('ting-emoji').value.trim();
  const color = typeof selectedEmojiBgColor === 'function'
    ? selectedEmojiBgColor('ting-emoji-bg')
    : '';
  if(emoji){
    preview.textContent = emoji;
    if(color){
      preview.style.background = `var(--${color}-bg)`;
      preview.style.color = `var(--${color}-icon)`;
    }else{
      preview.style.background = 'var(--bg2)';
      preview.style.color = 'var(--text)';
    }
    return;
  }
  const type = typeof selectedType !== 'undefined' ? selectedType : 'keepup';
  const icon = typeof defaultIcon === 'function' ? defaultIcon(type) : 'ti-heart';
  preview.innerHTML = `<i class="ti ${icon}" aria-hidden="true"></i>`;
  preview.style.background = 'var(--bg2)';
  preview.style.color = 'var(--text3)';
}

// RENDER: select a background swatch in the add color grid without revealing it.
function selectAddEmojiColor(token){
  const wrap = document.getElementById('ting-emoji-bg');
  if(!wrap)return;
  wrap.querySelectorAll('.emoji-bg-swatch').forEach(el=>{
    const on = (el.dataset.emojiBg || '') === (token || '');
    el.classList.toggle('on',on);
    el.setAttribute('aria-pressed',on ? 'true' : 'false');
  });
  updateEmojiPreview();
}

// RENDER: highlight the quick-pick chip that matches the current field value
// in both sheets (add + detail). Cheap — a handful of nodes.
function syncGenericEmojiRows(){
  for(const [containerId, inputId] of [['ting-generic-emoji','ting-emoji'],['detail-generic-emoji','detail-emoji']]){
    const wrap = document.getElementById(containerId);
    const input = document.getElementById(inputId);
    if(!wrap || !input)continue;
    const val = input.value.trim();
    wrap.querySelectorAll('.generic-emoji-chip').forEach(chip=>{
      const on = chip.textContent === val;
      chip.classList.toggle('on',on);
      chip.setAttribute('aria-pressed',on ? 'true' : 'false');
    });
  }
}

// RENDER: fill the generic quick-pick row for one sheet. Tapping a chip picks
// that emoji for the field; it also counts as a user choice, so later name
// edits never fight the pick (and the user can still clear it themselves).
function renderGenericEmojiRow(containerId, inputId){
  const wrap = document.getElementById(containerId);
  if(!wrap)return;
  wrap.textContent = '';
  for(const g of GENERIC_EMOJIS){
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'generic-emoji-chip';
    chip.textContent = g;
    chip.setAttribute('aria-label',`use ${g} emoji`);
    chip.addEventListener('click',()=>{
      const input = document.getElementById(inputId);
      if(!input)return;
      input.value = g;
      _emojiUserEdited = true;
      if(inputId === 'detail-emoji')_detailEmojiUserEdited = true;
      if(inputId === 'detail-emoji' && typeof setDetailDirty === 'function')setDetailDirty();
      syncGenericEmojiRows();
      updateEmojiPreview();
    });
    wrap.appendChild(chip);
  }
  syncGenericEmojiRows();
}

// HANDLER: as the name changes, auto-fill a matching emoji (unless the user
// has manually edited the field) and assign a disambiguating color. No match
// just leaves the field blank — the user can open the emoji editor for the
// generic quick-pick chips at any time via the preview tile.
function applyAutoEmoji(){
  if(_emojiUserEdited)return;
  const nameInput = document.getElementById('ting-message');
  const emojiInput = document.getElementById('ting-emoji');
  if(!nameInput || !emojiInput)return;
  const emoji = findEmojiMatch(nameInput.value);
  emojiInput.value = emoji || '';
  selectAddEmojiColor(emoji ? pickUniqueColor(emoji) : '');
}

// HANDLER: as the detail name changes, auto-fill the emoji field. A habit's
// own emoji (present when the sheet opened) is never touched, and manual
// edits stop the tracking — but an auto-suggested value follows the name,
// exactly like the add sheet.
function applyDetailAutoEmoji(){
  if(_detailEmojiUserEdited)return;
  if(_detailEmojiAtOpen)return;
  const nameInput = document.getElementById('detail-habit-message');
  const emojiInput = document.getElementById('detail-emoji');
  if(!nameInput || !emojiInput)return;
  const emoji = findEmojiMatch(nameInput.value);
  if(!emoji)return;
  emojiInput.value = emoji;
  syncGenericEmojiRows();
  if(typeof setDetailDirty === 'function')setDetailDirty();
}

function setupEmojiSuggestion(){
  const nameInput = document.getElementById('ting-message');
  const emojiInput = document.getElementById('ting-emoji');
  const preview = document.getElementById('ting-emoji-preview');
  const editArea = document.getElementById('ting-emoji-edit');
  const typeSeg = document.getElementById('type-seg');
  if(nameInput){
    nameInput.addEventListener('input',()=>{
      clearTimeout(_suggestTimer);
      _suggestTimer = setTimeout(applyAutoEmoji,300);
    });
  }
  if(emojiInput){
    emojiInput.addEventListener('input',()=>{
      _emojiUserEdited = true;
      if(!emojiInput.value.trim())selectAddEmojiColor('');
      updateEmojiPreview();
    });
  }
  // the tile is the single emoji affordance — tap it to open the editor
  if(preview){
    preview.addEventListener('click',()=>{
      if(editArea)editArea.hidden = false;
      if(emojiInput)emojiInput.focus({preventScroll:true});
    });
  }
  if(typeSeg){
    typeSeg.addEventListener('click',()=>setTimeout(updateEmojiPreview,0));
  }
  // generic quick-pick rows: always an emoji available, even with no match
  renderGenericEmojiRow('ting-generic-emoji','ting-emoji');
  renderGenericEmojiRow('detail-generic-emoji','detail-emoji');
  // detail sheet: suggest on rename only while the emoji field is empty
  const detailName = document.getElementById('detail-habit-message');
  const detailEmoji = document.getElementById('detail-emoji');
  if(detailName){
    detailName.addEventListener('input',()=>{
      clearTimeout(_detailSuggestTimer);
      _detailSuggestTimer = setTimeout(applyDetailAutoEmoji,300);
    });
  }
  if(detailEmoji){
    detailEmoji.addEventListener('input',()=>{
      _detailEmojiUserEdited = true;
      syncGenericEmojiRows();
    });
  }
  updateEmojiPreview();
}

// Reset per-open detail-sheet emoji state (suggestion + user-edited flag).
(function(){
  const orig = window.openDetail;
  if(typeof orig === 'function'){
    window.openDetail = function(i){
      _detailEmojiUserEdited = false;
      clearTimeout(_detailSuggestTimer);
      const r = orig(i);
      const el = document.getElementById('detail-emoji');
      _detailEmojiAtOpen = el ? el.value.trim() : '';
      return r;
    };
  }
})();

// HANDLER: reset auto-emoji state when the add sheet is cleared/closed.
function clearEmojiSuggestion(){
  clearTimeout(_suggestTimer);
  clearTimeout(_detailSuggestTimer);
  _emojiUserEdited = false;
  _detailEmojiUserEdited = false;
  _detailEmojiAtOpen = '';
  const editArea = document.getElementById('ting-emoji-edit');
  if(editArea)editArea.hidden = true;
  updateEmojiPreview();
}

setupEmojiSuggestion();
