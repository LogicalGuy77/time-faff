import Papa from "papaparse";
import {
  TAGS,
  Tag,
  UserStatus,
  tagPriorityMaps,
  imageMap,
  DEFAULT_IMAGE,
  impactOrder,
  categoryPopularTasks,
} from "./config";

export interface Task {
  id: string;
  title: string;
  time: string;
  timeInMinutes: number;
  impact: "High" | "Medium" | "Low";
  image: string;
  category: Tag[];
  status: UserStatus[];
  isPopular?: boolean;
}

/**
 * Normalizes a string by converting to lowercase and trimming whitespace.
 */
const normalizeString = (str: string): string => str.toLowerCase().trim();

/**
 * Finds an image for a task title using case-insensitive matching.
 * @param title - The task title to find an image for.
 * @returns The image URL or the default image if no match is found.
 */
const findImageForTask = (title: string): string => {
  const normalizedTitle = normalizeString(title);

  // Find a matching key in imageMap using case-insensitive comparison
  const matchingKey = Object.keys(imageMap).find(
    (key) => normalizeString(key) === normalizedTitle
  );

  return matchingKey ? imageMap[matchingKey] : DEFAULT_IMAGE;
};

/**
 * Normalizes and maps status categories to match the defined UserStatus type
 */
const normalizeStatus = (status: string): UserStatus => {
  const normalized = normalizeString(status);
  // Map variants to standard forms
  if (normalized === "parent") return "Parents";
  if (normalized === "parents") return "Parents";
  if (normalized === "single") return "Single";
  if (normalized === "couple") return "Couple";

  // Default fallback
  return "Single";
};

/**
 * Normalizes and maps tags to match the defined Tag constants
 */
const normalizeTag = (tag: string): Tag => {
  const normalized = normalizeString(tag);
  // Map common variants to standard forms
  const tagMappings: Record<string, Tag> = {
    "travel and mobility": "Travel and mobility",
    "social and dining": "Social and dining",
    "health and fitness": "Health and Fitness",
    "work and career": "Work and Career",
    "international living": "International Living",
    "event planning": "Event Planning",
    "wedding planning": "Wedding Planning",
    "pregnancy and baby": "Pregnancy and Baby",
    "pet care": "Pet Care",
    relocation: "Relocation",
    entertainment: "Entertainment",
  };

  return tagMappings[normalized] || "Health and Fitness"; // Default fallback
};

/**
 * Formats time from hours into a readable string like "1 hr 30 mins".
 * @param timeInHours - The time duration in hours.
 * @returns A formatted time string.
 */
const formatTime = (timeInHours: number): string => {
  if (!timeInHours || timeInHours <= 0) {
    return "0 mins";
  }

  if (timeInHours < 1) {
    return `${Math.round(timeInHours * 60)} mins`;
  }

  const hours = Math.floor(timeInHours);
  const minutes = Math.round((timeInHours - hours) * 60);

  const hourText = `${hours} hr${hours > 1 ? "s" : ""}`;
  const minuteText = minutes > 0 ? ` ${minutes} mins` : "";

  return `${hourText}${minuteText}`;
};

/**
 * Parses time string that might include "hours" or "hour" suffix
 * @param timeStr - Time string like "2 hours", "1 hour", "2.5", etc.
 * @returns Parsed time as number in hours
 */
const parseTimeString = (timeStr: string): number => {
  if (!timeStr) return 0;

  // Remove "hours", "hour", and any extra whitespace, then parse
  const cleanedTime = timeStr.replace(/\s*(hours?)\s*/gi, "").trim();

  return parseFloat(cleanedTime) || 0;
};

/**
 * Parses the raw CSV data into an array of Task objects.
 * @returns A promise that resolves to an array of tasks.
 */
const parseTasksFromCSV = async (): Promise<Task[]> => {
  try {
    const response = await fetch("/data/tasks.csv");
    if (!response.ok) {
      throw new Error(`Failed to fetch CSV: ${response.statusText}`);
    }
    const csvText = await response.text();

    const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });

    return parsed.data.map(
      (row: any, index: number): Task => {
        const title = row.Tasks?.trim() || "Untitled Task";
        const timeInHours = parseTimeString(row["Time(in hrs)"]);
        const tags =
          row.Tags?.split(",").map((t: string) => normalizeTag(t.trim())) || [];

        return {
          id: `task-${index + 1}`,
          title,
          time: formatTime(timeInHours),
          timeInMinutes: Math.round(timeInHours * 60),
          impact: row.Impact?.trim() || "Low",
          image: findImageForTask(title),
          // Only store the primary category initially
          category: tags.length > 0 ? [tags[0]] : [],
          status:
            row["Status categories"]
              ?.split(",")
              .map((s: string) => normalizeStatus(s.trim())) || [],
        };
      }
    );
  } catch (error) {
    console.error("Error parsing CSV data:", error);
    return []; // Return an empty array on failure
  }
};

// Fetch and parse tasks once, then reuse the result.
export const allTasksPromise: Promise<Task[]> = parseTasksFromCSV();

// Dynamically generate category filters from the single source of truth.
export const categoryFilters: readonly Tag[] = TAGS;

/**
 * Generates a list of 5 categories for a task based on user status.
 * @param primaryTag - The primary, most relevant tag for the task.
 * @param userStatus - The user's status.
 * @returns An array of 5 tags.
 */
const generateTaskCategories = (
  primaryTag: Tag,
  userStatus: UserStatus
): Tag[] => {
  if (!primaryTag) {
    return [];
  }

  const priorityMap = tagPriorityMaps[userStatus];
  if (!priorityMap) {
    return [primaryTag]; // Fallback if status has no priority map
  }

  // Create a sorted list of all possible tags by priority for the given status
  const sortedTags = [...TAGS].sort((a, b) => {
    const priorityA = priorityMap[normalizeString(a)] ?? 999;
    const priorityB = priorityMap[normalizeString(b)] ?? 999;
    return priorityA - priorityB;
  });

  // Filter out the primary tag and take the next 4
  const additionalTags = sortedTags
    .filter((tag) => normalizeString(tag) !== normalizeString(primaryTag))
    .slice(0, 4);

  return [primaryTag, ...additionalTags];
};

/**
 * Filters and sorts tasks based on user status and selected tags, following the new hero task logic.
 * @param taskList - The complete list of tasks.
 * @param userStatus - The user's current status (e.g., 'Single').
 * @param userTags - An array of tags selected by the user.
 * @returns A sorted and filtered array of up to 15 tasks.
 */
export const getTopTasks = (
  taskList: Task[],
  userStatus: UserStatus,
  userTags: string[]
): Task[] => {
  // Case 1: No status selected - do not proceed.
  if (!userStatus) {
    return [];
  }

  // Dynamically generate categories for each task based on user status
  const tasksWithDynamicCategories = taskList.map((task) => {
    const primaryTag = task.category[0];
    if (!primaryTag) {
      return task; // Return task as-is if it has no primary category
    }
    const newCategories = generateTaskCategories(primaryTag, userStatus);
    return { ...task, category: newCategories };
  });

  const normalizedUserStatus = normalizeString(userStatus);
  const priorityMap = tagPriorityMaps[userStatus] || {};

  // Case 2: Status selected but no categories - show all tasks for that persona, sorted.
  if (userTags.length === 0) {
    // Filter tasks that match the user status
    const statusFilteredTasks = tasksWithDynamicCategories.filter((task) =>
      task.status.map(normalizeString).includes(normalizedUserStatus)
    );

    // Apply priority scoring based on status preferences
    const tasksWithScores = statusFilteredTasks.map((task) => {
      const taskTags = task.category.map(normalizeString);
      const priorityScore = Math.min(
        ...taskTags.map((tag) => priorityMap[tag] ?? 999)
      );
      return { ...task, priorityScore };
    });

    // Sort by impact, then priority score, then alphabetically
    tasksWithScores.sort((a, b) => {
      const impactDiff = impactOrder[a.impact] - impactOrder[b.impact];
      if (impactDiff !== 0) return impactDiff;
      const scoreDiff = a.priorityScore - b.priorityScore;
      if (scoreDiff !== 0) return scoreDiff;
      return a.title.localeCompare(b.title);
    });

    return tasksWithScores;
  }

  // Case 3: Both status and categories selected - apply the new hero task logic.
  const normalizedUserTags = userTags.map(normalizeString);

  // Filter tasks that match both status and at least one category.
  const filteredTasks = tasksWithDynamicCategories.filter((task) => {
    const statusMatch = task.status
      .map(normalizeString)
      .includes(normalizedUserStatus);
    if (!statusMatch) return false;

    const categoryMatch = task.category
      .map(normalizeString)
      .some((taskTag) => normalizedUserTags.includes(taskTag));
    return categoryMatch;
  });

  if (filteredTasks.length === 0) {
    return []; // No tasks match the criteria.
  }

  // --- Hero Task Selection (Position 1) ---
  const getPriorityScore = (task: Task) => {
    const taskTags = task.category.map(normalizeString);
    const relevantTags = taskTags.filter((tag) =>
      normalizedUserTags.includes(tag)
    );
    if (relevantTags.length === 0) return 999;
    return Math.min(...relevantTags.map((tag) => priorityMap[tag] ?? 999));
  };

  // Find the pre-defined popular task for the highest-priority selected category
  const highestPriorityCategory = normalizedUserTags.sort(
    (a, b) => (priorityMap[a] ?? 999) - (priorityMap[b] ?? 999)
  )[0];

  const popularTaskTitle = categoryPopularTasks[highestPriorityCategory];
  let heroTask: Task | undefined = popularTaskTitle
    ? filteredTasks.find(
        (task) => normalizeString(task.title) === normalizeString(popularTaskTitle)
      )
    : undefined;

  // If a popular task is found and it has high impact, it becomes the hero task.
  if (heroTask && heroTask.impact === "High") {
    heroTask = { ...heroTask, isPopular: true };
  } else {
    // Fallback to original hero task logic if no high-impact popular task is found
    const highImpactTasks = filteredTasks.filter(
      (task) => task.impact === "High"
    );

    if (highImpactTasks.length > 0) {
      highImpactTasks.sort((a, b) => {
        const scoreDiff = getPriorityScore(a) - getPriorityScore(b);
        if (scoreDiff !== 0) return scoreDiff;
        return a.title.localeCompare(b.title);
      });
      heroTask = { ...highImpactTasks[0], isPopular: true };
    }
  }

  if (heroTask) {
    const finalHeroTask = heroTask; // To satisfy TypeScript's non-undefined check
    let remainingTasks = filteredTasks.filter(
      (task) => task.id !== finalHeroTask.id
    );

    // --- Top 5 High-Relevance Tasks (Positions 2-5) ---
    const top4Tasks: Task[] = [];
    const highImpactRemaining = remainingTasks
      .filter((task) => task.impact === "High")
      .sort((a, b) => {
        const scoreDiff = getPriorityScore(a) - getPriorityScore(b);
        if (scoreDiff !== 0) return scoreDiff;
        return a.title.localeCompare(b.title);
      });

    top4Tasks.push(...highImpactRemaining.slice(0, 4));
    remainingTasks = remainingTasks.filter(
      (task) => !top4Tasks.some((topTask) => topTask.id === task.id)
    );

    // --- Remaining Tasks (Positions 6-15) ---
    const otherTasks = remainingTasks
      .map((task) => ({ ...task, priorityScore: getPriorityScore(task) }))
      .sort((a, b) => {
        const impactDiff = impactOrder[a.impact] - impactOrder[b.impact];
        if (impactDiff !== 0) return impactDiff;
        const scoreDiff = a.priorityScore - b.priorityScore;
        if (scoreDiff !== 0) return scoreDiff;
        return a.title.localeCompare(b.title);
      });

    const finalTasks = [finalHeroTask, ...top4Tasks, ...otherTasks];
    return finalTasks.slice(0, 15);
  }

  // Fallback if no hero task is found at all
  const sortedTasks = filteredTasks
    .map((task) => ({ ...task, priorityScore: getPriorityScore(task) }))
    .sort((a, b) => {
      const impactDiff = impactOrder[a.impact] - impactOrder[b.impact];
      if (impactDiff !== 0) return impactDiff;
      const scoreDiff = a.priorityScore - b.priorityScore;
      if (scoreDiff !== 0) return scoreDiff;
      return a.title.localeCompare(b.title);
    });

  return sortedTasks.slice(0, 15); // Limit to 15 tasks
};
