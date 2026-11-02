(pkg => {
	const M = myt,
		LOCALE = 'en-US',
		
		{floor:mathFloor, ceil:mathCeil} = Math,
		
		ordinalRules = new Intl.PluralRules(LOCALE, {type:'ordinal'}),
		ORDINAL_SUFFIXES = new Map([
			['one',  'st'],
			['two',  'nd'],
			['few',  'rd'],
			['other','th']
		]);
	
	M.I18N.setResourceDictionary({
		getOrdinal: M.memoize(n => {
			if (n == null || typeof n !== 'number' || isNaN(n)) return '';
			n = n > 0 ? mathFloor(n) : mathCeil(n);
			return n + ORDINAL_SUFFIXES.get(ordinalRules.select(n));
		})
	}, LOCALE);
})(globalThis);
