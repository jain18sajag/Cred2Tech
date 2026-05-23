const CRITICAL_PARAMETERS = [
    '_min_loan', '_max_loan', '_roi_min', '_roi_max',
    '_pf_min', '_pf_max', '_max_tenure', '_dbr_foir',
    '_ltv_', 'bureau_cutoff', 'age_maturity_'
];

function isCriticalParameter(key) {
    if (!key) return false;
    const lowerKey = key.toLowerCase();
    return CRITICAL_PARAMETERS.some(crit => lowerKey.includes(crit));
}

function createResult(ok, value, warning = null, error = null) {
    return { ok, value, warning, error };
}

function isNormalizedWrapper(value) {
    return typeof value === 'object' && value !== null && Object.prototype.hasOwnProperty.call(value, 'type') && Object.prototype.hasOwnProperty.call(value, 'normalized');
}

function parseMoneySafe(value, strictMode = false) {
    if (value === undefined || value === null || value === '' || value === '---') {
        return createResult(true, null);
    }
    
    // Unpack normalized structure
    if (isNormalizedWrapper(value)) {
        if (value.error) {
            return createResult(false, null, null, value.error);
        }
        if (value.type === 'no_cap') {
            return createResult(true, 'NO_CAP');
        }
        if (value.normalized === null) {
            return createResult(false, null, null, "Ambiguous configuration");
        }
        return createResult(true, value.normalized);
    }

    let normalized = typeof value === 'object' ? (value.amount ?? value.value ?? value.percent ?? null) : String(value);
    if (normalized === null) return createResult(true, null);
    
    normalized = String(normalized).toLowerCase().trim();

    if (normalized === 'no cap' || normalized === 'no capping' || normalized === 'nocap') {
        return createResult(true, 'NO_CAP', "Legacy string NO_CAP resolved");
    }

    normalized = normalized.replace(/,/g, '').replace(/₹/g, '').replace(/months?/g, '').replace(/yrs?/g, '').trim();

    let multiplier = 1;
    if (normalized.includes('cr') || normalized.includes('crore')) {
        multiplier = 10000000;
        normalized = normalized.replace(/crores?|crs?/g, '').trim();
    } else if (normalized.includes('l') || normalized.includes('lakh') || normalized.includes('lac')) {
        multiplier = 100000;
        normalized = normalized.replace(/lakhs?|lacs?|l/g, '').trim();
    } else if (normalized.includes('k')) {
        multiplier = 1000;
        normalized = normalized.replace(/k/g, '').trim();
    }

    if (normalized.includes('greter') || normalized.includes('>') || normalized.includes('<')) {
        return createResult(false, null, null, `Invalid numeric format: "${value}"`);
    }

    const numeric = Number(normalized);
    if (!Number.isFinite(numeric)) {
        return createResult(false, null, null, `Failed to parse monetary value safely: "${value}"`);
    }

    return createResult(true, numeric * multiplier, "Legacy string parsing used");
}

function parsePercentSafe(value, strictMode = false) {
    if (value === undefined || value === null || value === '' || value === '---') {
        return createResult(true, null);
    }

    if (isNormalizedWrapper(value)) {
        if (value.error || value.normalized === null) {
            return createResult(false, null, null, value.error || "Ambiguous percentage configuration");
        }
        return createResult(true, value.normalized);
    }

    let normalized = typeof value === 'object' ? (value.percent ?? value.value ?? null) : String(value);
    if (normalized === null) return createResult(true, null);

    const strVal = String(normalized).toLowerCase().trim();
    
    if (strVal.includes('double') || strVal.includes('wammy') || strVal.includes('whammy') || (strVal.match(/%/g) || []).length > 1) {
        return createResult(false, null, null, `Ambiguous percentage string blocked: "${value}"`);
    }

    const match = strVal.match(/^(\d+(\.\d+)?)%$/);
    if (match) {
        return createResult(true, Number(match[1]) / 100, "Legacy string parsing used");
    }
    
    const fallbackMatch = strVal.match(/(\d+(\.\d+)?)%/);
    if (fallbackMatch && strVal.replace(/(\d+(\.\d+)?)%/, '').trim() !== '') {
        if (strictMode) {
             return createResult(false, null, null, `Extraneous text in percentage: "${value}"`);
        }
    }

    let cleanStr = strVal.replace(/,/g, '').replace(/%/g, '').trim();
    const numeric = Number(cleanStr);
    
    if (!Number.isFinite(numeric) || cleanStr === '') {
        return createResult(false, null, null, `Failed to parse percentage safely: "${value}"`);
    }

    if (strictMode && !strVal.includes('%')) {
        return createResult(false, null, null, `Ambiguous percentage: Missing % sign for "${value}"`);
    }

    let result = numeric > 1 ? numeric / 100 : numeric;
    let warning = "Legacy string parsing used";
    if (numeric >= 1 && !strVal.includes('%')) {
        warning += ` (Whole number without % assumed as ${result * 100}%)`;
    }

    return createResult(true, result, warning);
}

function parseTenureSafe(value, strictMode = false) {
    if (value === undefined || value === null || value === '' || value === '---') {
        return createResult(true, null);
    }

    if (isNormalizedWrapper(value)) {
        if (value.error || value.normalized === null) return createResult(false, null, null, value.error || "Ambiguous tenure configuration");
        return createResult(true, value.normalized);
    }

    let normalized = typeof value === 'object' ? (value.value ?? null) : String(value);
    if (normalized === null) return createResult(true, null);

    let strVal = String(normalized).toLowerCase().trim();
    
    let multiplier = 1;
    if (strVal.includes('year') || strVal.includes('yrs') || strVal.includes('yr')) {
        multiplier = 12;
    }
    
    strVal = strVal.replace(/years?/g, '').replace(/yrs?/g, '').replace(/months?/g, '').replace(/m/g, '').trim();
    const numeric = Number(strVal);
    
    if (!Number.isFinite(numeric) || strVal === '') {
        return createResult(false, null, null, `Failed to parse tenure safely: "${value}"`);
    }

    return createResult(true, numeric * multiplier, "Legacy string parsing used");
}

function parseBooleanSafe(value, strictMode = false) {
    if (value === undefined || value === null || value === '' || value === '---') {
        return createResult(true, null);
    }

    if (isNormalizedWrapper(value)) {
        if (value.error || value.normalized === null) return createResult(false, null, null, value.error || "Ambiguous boolean configuration");
        return createResult(true, value.normalized);
    }

    let strVal = typeof value === 'object' ? (value.value ?? null) : String(value);
    if (strVal === null) return createResult(true, null);
    
    strVal = String(strVal).toLowerCase().trim();
    
    if (['yes', 'true', 'y', '1'].includes(strVal)) return createResult(true, true, "Legacy string parsing used");
    if (['no', 'false', 'n', '0'].includes(strVal)) return createResult(true, false, "Legacy string parsing used");
    
    return createResult(false, null, null, `Failed to parse boolean safely: "${value}"`);
}

function parseIntegerSafe(value, strictMode = false) {
    if (value === undefined || value === null || value === '' || value === '---') {
        return createResult(true, null);
    }

    if (isNormalizedWrapper(value)) {
        if (value.error || value.normalized === null) return createResult(false, null, null, value.error || "Ambiguous integer configuration");
        return createResult(true, value.normalized);
    }

    let normalized = typeof value === 'object' ? (value.value ?? null) : String(value);
    if (normalized === null) return createResult(true, null);

    let strVal = String(normalized).toLowerCase().trim();
    strVal = strVal.replace(/years?/g, '').replace(/yrs?/g, '').trim();
    
    const numeric = Number(strVal);
    
    if (!Number.isFinite(numeric) || strVal === '') {
        return createResult(false, null, null, `Failed to parse integer safely: "${value}"`);
    }

    return createResult(true, numeric, "Legacy string parsing used");
}

function parseFoirRuleSafe(value, strictMode = false) {
    if (value === undefined || value === null || value === '' || value === '---') {
        return createResult(true, null);
    }

    if (isNormalizedWrapper(value)) {
        if (value.error || value.normalized === null) return createResult(false, null, null, value.error || "Ambiguous FOIR configuration");
        return createResult(true, value.normalized);
    }

    let strVal = typeof value === 'object' ? (value.value ?? value.percent ?? null) : String(value);
    if (strVal === null) return createResult(true, null);
    
    strVal = String(strVal).toLowerCase().trim();

    // Support conditional underwriting structures: e.g. "Max 100% ( Double wammy - 140%)"
    const conditionalRegex = /(?:max\s+)?(\d+)%\s*\(\s*(double\s+wh?ammy)\s*-\s*(\d+)%\s*\)/i;
    const condMatch = strVal.match(conditionalRegex);
    if (condMatch) {
        const baseLimit = parseInt(condMatch[1], 10);
        const specialProgram = condMatch[2].toLowerCase().replace(/\s+/g, '_').replace('whammy', 'wammy');
        const specialLimit = parseInt(condMatch[3], 10);
        return createResult(true, {
            type: "conditional_foir",
            base_limit: baseLimit,
            special_program: specialProgram,
            special_limit: specialLimit,
            requires_manual_underwriting: true
        });
    }

    if (strVal.includes('double') || strVal.includes('wammy') || strVal.includes('whammy')) {
        return createResult(false, null, null, `Ambiguous percentage string blocked: "${value}"`);
    }

    // Dynamic slab parsing: e.g. "<75k -60%, >75k - 70%" or "<75k -50%, >75k -65%"
    const slabRegex = /<(\d+)k\s*-\s*(\d+)%,\s*>(\d+)k\s*-\s*(\d+)%/;
    const match = strVal.match(slabRegex);
    if (match) {
        const minThresh = parseInt(match[1]) * 1000;
        const pct1 = parseInt(match[2]) / 100;
        const maxThresh = parseInt(match[3]) * 1000;
        const pct2 = parseInt(match[4]) / 100;
        
        // Ensure logical boundaries (e.g. 75k and 75k align)
        if (minThresh === maxThresh) {
            const slab = [
                { income_max: minThresh, value: pct1 },
                { income_min: maxThresh + 1, value: pct2 }
            ];
            return createResult(true, slab, "Legacy slab string dynamically converted");
        }
    }

    if (strVal === 'max 100%' || strVal === '100%') {
        return createResult(true, 1.0, "Legacy string parsing used");
    }
    
    if (strVal.includes('<') || strVal.includes('>')) {
        return createResult(false, null, null, `Unrecognized FOIR slab string: "${value}"`);
    }

    return parsePercentSafe(value, true); // Force strictMode=true to reject extra text
}

function normalizeParameter(key, rawValue) {
    const lowerKey = key.toLowerCase();
    
    let result;
    let type = 'string';
    
    if (lowerKey.includes('foir')) {
        result = parseFoirRuleSafe(rawValue, true);
        if (result.ok && result.value && result.value.type === 'conditional_foir') {
            type = 'conditional_foir';
        } else {
            type = Array.isArray(result.value) ? 'slab' : 'percent';
        }
    } else if (lowerKey.includes('ltv') || lowerKey.includes('roi') || lowerKey.includes('pf')) {
        result = parsePercentSafe(rawValue, true);
        type = 'percent';
    } else if (lowerKey.includes('age') || lowerKey.includes('cutoff')) {
        result = parseIntegerSafe(rawValue, true);
        type = 'integer';
    } else if (lowerKey.includes('tenure')) {
        result = parseTenureSafe(rawValue, true);
        type = 'integer';
    } else if (lowerKey.includes('loan') || lowerKey.includes('income')) {
        result = parseMoneySafe(rawValue, true);
        type = result.value === 'NO_CAP' ? 'no_cap' : 'money';
        if (result.value === 'NO_CAP') result.value = null; // No cap stores as null
    } else if (lowerKey.includes('elig_')) {
        result = parseBooleanSafe(rawValue, true);
        type = 'boolean';
    } else {
        // Fallback for uncategorized text fields
        return { raw: rawValue, normalized: rawValue, type: 'string' };
    }

    if (!result.ok) {
        return {
            raw: rawValue,
            normalized: null,
            type: "unsupported_rule",
            error: result.error
        };
    }

    if (isCriticalParameter(key) && result.value === null && type !== 'no_cap') {
        return {
            raw: rawValue,
            normalized: null,
            type: "unsupported_rule",
            error: "Missing required configuration for critical parameter"
        };
    }

    return {
        raw: rawValue,
        normalized: result.value,
        type
    };
}

module.exports = {
    isCriticalParameter,
    createResult,
    parseMoneySafe,
    parsePercentSafe,
    parseTenureSafe,
    parseIntegerSafe,
    parseBooleanSafe,
    parseFoirRuleSafe,
    normalizeParameter
};
