/** Bump when probe phrases change to invalidate cached taste profiles. */
export const PROBES_VERSION = 1;

/**
 * Sub-topic probe phrases per category.
 * Used by the taste profile to map user preferences at sub-topic granularity.
 * Only probes for active (non-archived) categories are used at runtime.
 */
export const TASTE_PROBES: Record<string, string[]> = {
  "news": [
    "breaking news and current events",
    "investigative journalism and long-form reporting",
    "media industry trends and press freedom",
  ],
  "ai-research": [
    "transformer architectures and attention mechanisms",
    "LLM benchmarks and evaluation methods",
    "AI safety and alignment research",
    "open source machine learning models and frameworks",
    "neural network training techniques and optimization",
  ],
  "startups": [
    "startup fundraising and venture capital rounds",
    "Y Combinator companies and accelerator programs",
    "founder stories and startup lessons",
    "product-market fit and growth strategies",
  ],
  "deep-tech": [
    "semiconductor fabrication and chip design",
    "quantum computing research and applications",
    "robotics and autonomous systems",
    "advanced materials and nanotechnology",
  ],
  "science": [
    "physics discoveries and particle research",
    "biology and genetics breakthroughs",
    "astronomy and space science observations",
    "chemistry and materials science advances",
  ],
  "programming": [
    "programming languages and compiler design",
    "developer tools and IDE productivity",
    "software architecture and design patterns",
    "web frameworks and frontend development",
    "systems programming and performance optimization",
  ],
  "open-source": [
    "open source project launches and releases",
    "open source licensing and governance",
    "community-driven software development",
    "open source alternatives to commercial software",
  ],
  "security": [
    "cybersecurity vulnerabilities and exploits",
    "privacy regulations and data protection",
    "encryption and cryptographic protocols",
    "security tooling and penetration testing",
  ],
  "design": [
    "user interface design and visual aesthetics",
    "user experience research and usability testing",
    "design systems and component libraries",
    "accessibility and inclusive design practices",
  ],
  "product": [
    "SaaS business models and pricing strategies",
    "product management and roadmap planning",
    "user analytics and conversion optimization",
    "B2B enterprise software and sales",
  ],
  "finance": [
    "stock market analysis and trading strategies",
    "macroeconomics and central bank policy",
    "personal finance and investing advice",
    "fintech innovation and digital banking",
  ],
  "crypto": [
    "cryptocurrency market movements and trading",
    "blockchain protocol development and upgrades",
    "DeFi protocols and decentralized exchanges",
    "crypto regulation and legal frameworks",
  ],
  "politics": [
    "elections and political campaigns",
    "government policy and legislation debates",
    "international diplomacy and geopolitics",
    "political commentary and opinion analysis",
  ],
  "legal": [
    "tech regulation and antitrust enforcement",
    "intellectual property and patent disputes",
    "civil rights and constitutional law",
    "corporate governance and compliance",
  ],
  "climate": [
    "climate change research and data",
    "renewable energy technology and deployment",
    "carbon capture and emissions reduction",
    "environmental policy and sustainability",
  ],
  "space": [
    "space launches and rocket engineering",
    "satellite technology and orbital systems",
    "planetary exploration and Mars missions",
    "commercial space industry and space tourism",
  ],
  "health": [
    "drug development and clinical trials",
    "biotech startups and gene therapy",
    "public health and epidemiology",
    "mental health research and wellness",
  ],
  "education": [
    "online learning platforms and EdTech",
    "university research and academic publishing",
    "STEM education and coding bootcamps",
    "education policy and school reform",
  ],
  "gaming": [
    "video game releases and reviews",
    "game development and engine technology",
    "esports competitions and streaming",
    "indie games and game design craft",
  ],
  "sports": [
    "professional sports scores and highlights",
    "sports analytics and performance data",
    "athlete stories and career milestones",
    "sports business and team management",
  ],
  "music": [
    "album releases and music reviews",
    "music production and audio engineering",
    "live concerts and festival culture",
    "music industry business and streaming",
  ],
  "culture": [
    "film and television criticism",
    "literature and book recommendations",
    "visual arts exhibitions and galleries",
    "cultural commentary and social trends",
  ],
  "food": [
    "recipes and cooking techniques",
    "restaurant reviews and food culture",
    "food science and nutrition research",
    "food industry and agricultural technology",
  ],
  "travel": [
    "travel destinations and trip planning",
    "budget travel and backpacking tips",
    "travel technology and booking platforms",
    "cultural immersion and local experiences",
  ],
  "parenting": [
    "child development and parenting strategies",
    "family technology and screen time management",
    "education choices and homeschooling",
    "work-life balance for parents",
  ],
};
