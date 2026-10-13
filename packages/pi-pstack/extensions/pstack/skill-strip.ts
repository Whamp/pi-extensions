import { realpathSync } from "node:fs";

/** Skill filtering result; retained entries are preserved byte-for-byte. */
export interface StripResult {
	prompt: string;
	removed: number;
}

const OPEN_TAG = "\n<available_skills>";
const CLOSE_TAG = "</available_skills>";
const ENTRY_DELIMITER = "  <skill>";
const ENTRY_SPLIT = /(?=  <skill>)/;
const LOCATION_PATTERN = /<location>([\s\S]*?)<\/location>/;
const HEADER_MARKER = "\n\nThe following skills provide specialized instructions";

function decodeXmlEntities(value: string): string {
	return value
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&quot;", '"')
		.replaceAll("&apos;", "'")
		.replaceAll("&amp;", "&");
}

function resolveSkillPath(location: string): string | undefined {
	try {
		return realpathSync(location);
	} catch (error) {
		if (
			error instanceof Error &&
			"code" in error &&
			(error.code === "ENOENT" || error.code === "ENOTDIR")
		) {
			return undefined;
		}
		throw error;
	}
}

/** Removes package skills, including shared symlinks; unexpected filesystem errors propagate. */
export function stripSkillsByLocationPrefix(
	systemPrompt: string,
	locationPrefix: string,
): StripResult {
	const prefix = locationPrefix.trim().replace(/\/$/, "");
	if (!prefix) {
		return { prompt: systemPrompt, removed: 0 };
	}

	const openStart = systemPrompt.indexOf(OPEN_TAG);
	if (openStart === -1) {
		return { prompt: systemPrompt, removed: 0 };
	}
	const contentStart = openStart + OPEN_TAG.length;
	const closeStart = systemPrompt.indexOf(CLOSE_TAG, contentStart);
	if (closeStart === -1) {
		return { prompt: systemPrompt, removed: 0 };
	}

	const canonicalPrefix = resolveSkillPath(prefix);

	const chunks = systemPrompt.slice(contentStart, closeStart).split(ENTRY_SPLIT);
	const kept: string[] = [];
	let removed = 0;
	for (const chunk of chunks) {
		if (!chunk.startsWith(ENTRY_DELIMITER)) {
			kept.push(chunk);
			continue;
		}
		const rawLocation = chunk.match(LOCATION_PATTERN)?.[1] ?? "";
		const location = decodeXmlEntities(rawLocation);
		const canonicalLocation = resolveSkillPath(location);
		const belongsToPackage =
			canonicalPrefix !== undefined && canonicalLocation !== undefined
				? canonicalLocation.startsWith(`${canonicalPrefix}/`)
				: location.startsWith(`${prefix}/`);
		if (belongsToPackage) {
			removed++;
			continue;
		}
		kept.push(chunk);
	}
	if (removed === 0) {
		return { prompt: systemPrompt, removed: 0 };
	}

	const anyKeptEntry = kept.some((chunk) => chunk.startsWith(ENTRY_DELIMITER));
	if (!anyKeptEntry) {
		const headerStart = systemPrompt.slice(0, openStart).indexOf(HEADER_MARKER);
		const cutStart = headerStart !== -1 ? headerStart : openStart;
		return {
			prompt: systemPrompt.slice(0, cutStart) + systemPrompt.slice(closeStart + CLOSE_TAG.length),
			removed,
		};
	}
	return {
		prompt: systemPrompt.slice(0, contentStart) + kept.join("") + systemPrompt.slice(closeStart),
		removed,
	};
}
