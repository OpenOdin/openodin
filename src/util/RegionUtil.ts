export const ISO3166_1_CODES = [
    "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR", "AS", "AT", "AU", "AW", "AX", "AZ",
    "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BO", "BQ", "BQ", "BR",
    "BS", "BT", "BV", "BW", "BY", "BZ", "CA", "CC", "CD", "CF", "CG", "CH", "CI", "CK", "CL", "CM",
    "CN", "CO", "CR", "CU", "CV", "CW", "CX", "CY", "CZ", "DE", "DJ", "DK", "DM", "DO", "DZ", "EC",
    "EE", "EG", "EH", "ER", "ES", "ET", "FI", "FJ", "FK", "FM", "FO", "FR", "GA", "GB", "GD", "GE",
    "GF", "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GS", "GT", "GU", "GW", "GY", "HK",
    "HM", "HN", "HR", "HT", "HU", "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR", "IS", "IT", "JE",
    "JM", "JO", "JP", "KE", "KG", "KH", "KI", "KM", "KN", "KP", "KR", "KW", "KY", "KZ", "LA", "LB",
    "LC", "LI", "LK", "LR", "LS", "LT", "LU", "LV", "LY", "MA", "MC", "MD", "ME", "MF", "MG", "MH",
    "MK", "ML", "MM", "MN", "MO", "MP", "MQ", "MR", "MS", "MT", "MU", "MV", "MW", "MX", "MY", "MZ",
    "NA", "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP", "NR", "NU", "NZ", "OM", "PA", "PE", "PF",
    "PG", "PH", "PK", "PL", "PM", "PN", "PR", "PS", "PT", "PW", "PY", "QA", "RE", "RO", "RS", "RU",
    "RW", "SA", "SB", "SC", "SD", "SE", "SG", "SH", "SI", "SJ", "SK", "SL", "SM", "SN", "SO", "SR",
    "SS", "ST", "SV", "SX", "SY", "SZ", "TC", "TD", "TF", "TG", "TH", "TJ", "TK", "TL", "TM", "TN",
    "TO", "TR", "TT", "TV", "TW", "TZ", "UA", "UG", "UM", "US", "UY", "UZ", "VA", "VC", "VE", "VG",
    "VI", "VN", "VU", "WF", "WS", "YE", "YT", "ZA", "ZM", "ZW"
];

export const ISO3166_EU_CODES = [
    "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV",
    "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"
];

export class RegionUtil {

    /**
     * Return all associated regions for given country code.
     * For "SE" returns ["SE", "EU"].
     * For "GB" returns ["GB"].
     * For "EU" returns ["EU"].
     */
    public static GetRegions(countryCode: string): string[] {
        if (countryCode === "EU") {
            return [countryCode];
        }

        if (RegionUtil.IsEU(countryCode)) {
            return [countryCode, "EU"];
        }

        return [countryCode];
    }

    /**
     * Return all associated jurisdictions for given country code.
     * For "SE" returns ["SE", "EU"].
     * For "GB" returns ["GB"].
     * For "EU" returns ["EU"].
     */
    public static GetJurisdictions(countryCode: string): string[] {
        if (countryCode === "EU") {
            return [countryCode];
        }

        if (RegionUtil.IsEU(countryCode)) {
            return [countryCode, "EU"];
        }

        return [countryCode];
    }

    public static IsEU(countryCode: string): boolean {
        if (countryCode === "EU") {
            return true;
        }

        return ISO3166_EU_CODES.includes(countryCode);
    }

    //eslint-disable-next-line @typescript-eslint/no-unused-vars
    public static GetRegionByIpAddress(ipAddress: string | undefined): string | undefined {
        //TODO: FIXME: 0.9.8-beta1.
        return undefined;
    }

    /**
     * Checks if target and source country codes are equal,
     * if not then checks if source is the EU and target country is within the EU.
     *
     * @returns true if targetRegion is allowed compared to sourceRegion.
     */
    public static IsRegionAllowed(targetRegion: string, sourceRegion: string): boolean {
        if (targetRegion === sourceRegion) {
            return true;
        }

        if (sourceRegion === "EU" && RegionUtil.IsEU(targetRegion)) {
            return true;
        }

        return false;
    }

    /**
     * Checks if target and source country codes are equal,
     * if not then checks if source is the EU and target country is within the EU.
     *
     * @returns true if targetJurisdiction is allowed compared to sourceJurisdiction.
     */
    public static IsJurisdictionAllowed(targetJurisdiction: string, sourceJurisdiction: string): boolean {
        if (targetJurisdiction === sourceJurisdiction) {
            return true;
        }

        if (sourceJurisdiction === "EU" && RegionUtil.IsEU(targetJurisdiction)) {
            return true;
        }

        return false;
    }

    /**
     * Check if the source and the target are the same or if the source is EU and the target is within the EU.
     * @returns country code to be used in FetchQuery.
     */
    public static IntersectRegions(targetRegion: string | undefined, sourceRegion: string | undefined): string {
        if (targetRegion === sourceRegion) {
            return targetRegion ?? "";
        }

        if (targetRegion === "EU" && sourceRegion && RegionUtil.IsEU(sourceRegion)) {
            return targetRegion;
        }

        return "";
    }

    /**
     * Check if the source and the target are the same or if the source is EU and the target is within the EU.
     * @returns country code to be used in FetchQuery.
     */
    public static IntersectJurisdictions(targetJurisdiction: string | undefined, sourceJurisdiction: string | undefined): string {
        if (targetJurisdiction === sourceJurisdiction) {
            return targetJurisdiction ?? "";
        }

        if (targetJurisdiction === "EU" && sourceJurisdiction && RegionUtil.IsEU(sourceJurisdiction)) {
            return targetJurisdiction;
        }

        return "";
    }
}
