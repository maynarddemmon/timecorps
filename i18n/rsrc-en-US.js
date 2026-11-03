(pkg => {
	const M = myt,
		LOCALE = 'en-US',
		
		{floor:mathFloor, ceil:mathCeil} = Math,
		
		{ListFormat, PluralRules} = Intl,
		
		ordinalRules = new PluralRules(LOCALE, {type:'ordinal'}),
		ORDINAL_SUFFIXES = new Map([
			['one',  'st'],
			['two',  'nd'],
			['few',  'rd'],
			['other','th']
		]),
		
		andConcatenator = new ListFormat(LOCALE, {style:'long', type:'conjunction'}),
		orConcatenator = new ListFormat(LOCALE, {style:'long', type:'disjunction'}),
		unitConcatenator = new ListFormat(LOCALE, {style:'long', type:'unit'});
	
	M.I18N.setResourceDictionary({
		getOrdinal: M.memoize(n => {
			if (n == null || typeof n !== 'number' || isNaN(n)) return '';
			n = n > 0 ? mathFloor(n) : mathCeil(n);
			return n + ORDINAL_SUFFIXES.get(ordinalRules.select(n));
		}),
		concatenate: (arr, type) => {
			if (!arr) return '';
			
			let formatFunc;
			switch (type) {
				case 'and':
					formatFunc = andConcatenator;
					break;
				case 'or':
					formatFunc = orConcatenator;
					break;
				case 'unit':
				default:
					formatFunc = unitConcatenator;
					break;
			}
			return formatFunc.format(arr);
		}
	}, LOCALE);
})(globalThis);
