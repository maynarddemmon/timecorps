(pkg => {
    'use strict';
    
    const {
            min:mathMin, max:mathMax, round:mathRound, ceil:mathCeil, floor:mathFloor, 
            abs:mathAbs, trunc:mathTrunc
        } = Math,
        
        // Time Parsing and Formatting /////////////////////////////////////////
        TO_SECOND = 'second',
        TO_MINUTE = 'minute',
        TO_HOUR = 'hour',
        TO_DAY = 'day',
        TO_MONTH = 'month',
        TO_YEAR = 'year',
        TO_DECADE = 'decade',
        TO_CENTURY = 'century',
        TO_MILLENIUM = 'millenium',
        
        /*  Coarse to fine. Used to take the coarser of two precisions, which is
            how "never show more than was authored" is enforced. */
        PRECISION_ORDER = [
            TO_MILLENIUM, TO_CENTURY, TO_DECADE, TO_YEAR,
            TO_MONTH, TO_DAY, TO_HOUR, TO_MINUTE, TO_SECOND
        ],
        PRECISION_RANK = PRECISION_ORDER.reduce((o, p, i) => (o[p] = i, o), {}),
        
        MONTH_NAMES = [
            'January','February','March','April','May','June','July','August','September','October','November','December'
        ],
        
        MILLIS_PER_SECOND = 1000,
        MILLIS_PER_MINUTE = 60 * MILLIS_PER_SECOND,
        MILLIS_PER_HOUR = 60 * MILLIS_PER_MINUTE,
        MILLIS_PER_DAY = 24 * MILLIS_PER_HOUR,
        MILLIS_PER_WEEK = 7 * MILLIS_PER_DAY,
        MILLIS_PER_MONTH = MILLIS_PER_DAY * 30.41, // Approximate
        MILLIS_PER_YEAR = MILLIS_PER_DAY * 365, // Approximate (no leap years, leap seconds, etc.)
        MILLIS_PER_DECADE = 10 * MILLIS_PER_YEAR,
        MILLIS_PER_CENTURY = 10 * MILLIS_PER_DECADE,
        MILLIS_PER_MILLENIUM = 10 * MILLIS_PER_CENTURY,
        
        SCALE_MILLIS = {
            [TO_SECOND]:MILLIS_PER_SECOND, [TO_MINUTE]:MILLIS_PER_MINUTE, [TO_HOUR]:MILLIS_PER_HOUR, [TO_DAY]:MILLIS_PER_DAY
        },
        SCALE_YEARS = {
            [TO_YEAR]:1, [TO_DECADE]:10, [TO_CENTURY]:100, [TO_MILLENIUM]:1000
        },
        
        /*  A SHAPE GUARD, not a parser. Native Date already handles every
            well-formed case here, including expanded years and truncated forms.
            What it does NOT do is fail on near-misses: "1028-3-7", "793-03-07"
            and "1028/03/07" all parse successfully down Date's
            implementation-defined path and silently pick up the local timezone.
            Those are the ones a warning never catches, so reject by shape first. */
        ISO_SHAPE = /^([+-]\d{6}|\d{4})(-\d{2}(-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?)?)?)?Z?$/,
        
        toDate = date => date instanceof Date ? date : new Date(date),
        
        /*  Astronomical year to era. ISO year 0 IS 1 BCE, so this is 1 - y and
            NOT a sign flip. Everything era-facing rounds in THIS space: rounding
            -19999 to the nearest thousand gives -20000, which converts to
            20,001 BCE and is off by one in a way nobody would ever spot. */
        toEra = astroYear => astroYear <= 0 ? {n:1 - astroYear, era:'BCE'} : {n:astroYear, era:'CE'},
        
        /*  Thousands separator only once it helps — "1,912" is wrong, "20,000
            BCE" is right. CE stated only where the number could be mistaken for
            a quantity: below 1000 and above 9999. */
        eraLabel = ({n, era}) => {
            const digits = n >= 10000 ? n.toLocaleString('en-US') : String(n);
            return era === 'BCE' ? digits + ' BCE'
                 : (n < 1000 || n >= 10000) ? digits + ' CE' : digits;
        },
        
        ordinal = n => {
            const tail = n % 100;
            return n + ((tail >= 11 && tail <= 13) ? 'th' : (['th','st','nd','rd'][n % 10] || 'th'));
        },
        
        pad2 = v => String(v).padStart(2, '0'),
        
        timeUtil = pkg.timeUtil = {
            TO_SECOND, 
            TO_MINUTE, 
            TO_HOUR, 
            TO_DAY, 
            TO_MONTH,
            TO_YEAR, 
            TO_DECADE, 
            TO_CENTURY, 
            TO_MILLENIUM,
            
            PRECISION_ORDER,
            
            MILLIS_PER_SECOND,
            MILLIS_PER_MINUTE,
            MILLIS_PER_HOUR,
            MILLIS_PER_DAY,
            MILLIS_PER_WEEK,
            MILLIS_PER_MONTH,
            MILLIS_PER_YEAR,
            MILLIS_PER_DECADE,
            MILLIS_PER_CENTURY,
            MILLIS_PER_MILLENIUM,
            
            SCALE_TO_MILLIS: {
                [TO_SECOND]: MILLIS_PER_SECOND,
                [TO_MINUTE]: MILLIS_PER_MINUTE,
                [TO_HOUR]: MILLIS_PER_HOUR,
                [TO_DAY]: MILLIS_PER_DAY,
                [TO_MONTH]: MILLIS_PER_MONTH,
                [TO_YEAR]: MILLIS_PER_YEAR,
                [TO_DECADE]: MILLIS_PER_DECADE,
                [TO_CENTURY]: MILLIS_PER_CENTURY,
                [TO_MILLENIUM]: MILLIS_PER_MILLENIUM
            },
            
            /*  Converts a duration object into milliseconds. If a nullish value is provided, zero
                is returned. If a number is provided it is returned as is. The object format
                supports:
                    ms: milliseconds
                     s: seconds
                     m: minutes
                     h: hours
                     d: days
                     w: weeks
                
                Note there is deliberately no y or mo: years and months are not
                fixed lengths, and a duration that means "until this date" should
                be authored as an end instant instead. */
            durationToMillis: spec => {
                if (spec == null) return 0;
                if (typeof spec === 'number') return spec;
                return (spec.w || 0) * MILLIS_PER_WEEK
                     + (spec.d || 0) * MILLIS_PER_DAY
                     + (spec.h || 0) * MILLIS_PER_HOUR
                     + (spec.m || 0) * MILLIS_PER_MINUTE
                     + (spec.s || 0) * MILLIS_PER_SECOND
                     + (spec.ms || 0);
            },
            
            /*  Parse a date string into milliseconds from the epoch. Rejects by
                shape, then hands the well-formed string to native Date. A time
                component with no zone gets a Z appended — without it Date reads
                the string as LOCAL, so the same config file means different
                things on different machines and nothing warns. */
            stringToMillis: str => {
                let millis = NaN,
                    trimmed = String(str).trim();
                if (ISO_SHAPE.test(trimmed)) {
                    const needsZone = trimmed.includes('T') && !trimmed.endsWith('Z');
                    millis = new Date(needsZone ? trimmed + 'Z' : trimmed).getTime();
                }
                if (isNaN(millis)) {
                    console.warn('Invalid Date String', str);
                    millis = 0;
                }
                return millis;
            },
            
            /*  The coarser of two precisions. Use to clamp what a player may see
                against what the author actually knew. */
            coarser: (a, b) => PRECISION_ORDER[
                mathMin(PRECISION_RANK[a] ?? 0, PRECISION_RANK[b] ?? 0)
            ],
            
            format: (date, precision=TO_SECOND) => {
                const d = toDate(date),
                    era = toEra(d.getUTCFullYear()),
                    year = eraLabel(era),
                    day = d.getUTCDate(),
                    month = MONTH_NAMES[d.getUTCMonth()];
                switch (precision) {
                    case TO_MILLENIUM:
                        // "c." only where the number is genuinely a rounding
                        return 'c. ' + eraLabel({n:mathMax(1000, mathRound(era.n / 1000) * 1000), era:era.era});
                    case TO_CENTURY:
                        return ordinal(mathCeil(era.n / 100)) + ' century' + (era.era === 'BCE' ? ' BCE' : '');
                    case TO_DECADE:
                        return (mathFloor(era.n / 10) * 10) + 's' + (era.era === 'BCE' ? ' BCE' : '');
                    case TO_YEAR:
                        return year;
                    case TO_MONTH:
                        return month + ', ' + year;
                    case TO_DAY:
                        return day + ' ' + month + ', ' + year;
                    case TO_HOUR:
                        // "23:00" would claim you know the minute is zero. You do not.
                        return day + ' ' + month + ', ' + year + ' around ' + pad2(d.getUTCHours()) + ':00';
                    case TO_MINUTE:
                        return day + ' ' + month + ', ' + year + ' · ' +  pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
                    case TO_SECOND:
                    default:
                        return day + ' ' + month + ', ' + year + ' · ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ':' + pad2(d.getUTCSeconds());
                }
            },
            
            /*  Clock only, for agent clocks and action windows inside an event
                where the block already establishes the date. */
            formatClock: (date, withSeconds) => {
                const d = toDate(date),
                    base = pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
                return withSeconds ? base + ':' + pad2(d.getUTCSeconds()) : base;
            },
            
            /*  Elapsed time, for action blocks and travel legs. */
            formatDuration: millis => {
                const abs = mathAbs(millis),
                    unit = (v, one, many) => v + ' ' + (v === 1 ? one : many);
                if (abs < MILLIS_PER_SECOND) return millis + ' ms';
                if (abs < MILLIS_PER_MINUTE) return mathRound(millis / MILLIS_PER_SECOND) + ' sec';
                if (abs < MILLIS_PER_HOUR) {
                    const m = mathTrunc(millis / MILLIS_PER_MINUTE),
                        s = mathRound((abs % MILLIS_PER_MINUTE) / MILLIS_PER_SECOND);
                    return s ? m + 'm ' + s + 's' : m + ' min';
                }
                if (abs < MILLIS_PER_DAY) {
                    const h = mathTrunc(millis / MILLIS_PER_HOUR),
                        m = mathRound((abs % MILLIS_PER_HOUR) / MILLIS_PER_MINUTE);
                    return m ? h + 'h ' + m + 'm' : h + ' hr';
                }
                if (abs < 30 * MILLIS_PER_DAY)  return unit(mathRound(millis / MILLIS_PER_DAY), 'day', 'days');
                if (abs < 365 * MILLIS_PER_DAY) return unit(mathRound(millis / (30 * MILLIS_PER_DAY)), 'month', 'months');
                return unit(+(millis / (365.2425 * MILLIS_PER_DAY)).toFixed(1), 'year', 'years');
            },
            
            /*  Largest boundary at or before the given instant.
                
                Fine scales just truncate components. Year and coarser floor the
                astronomical year to a multiple of the step — Math.floor is
                correct for negatives here, since astronomical years increase
                monotonically with time and -19999 floors to -20000, which is
                genuinely earlier. Do NOT convert to BCE first: era numbers run
                backwards, so flooring there would move you forward in time. */
            roundBackToScale: (dateObj, scale) => {
                const d = new Date(toDate(dateObj).getTime());
                switch (scale) {
                    case TO_SECOND:
                        d.setUTCMilliseconds(0);
                        return d;
                    case TO_MINUTE:
                        d.setUTCSeconds(0, 0);
                        return d;
                    case TO_HOUR:
                        d.setUTCMinutes(0, 0, 0);
                        return d;
                    case TO_DAY:
                        d.setUTCHours(0, 0, 0, 0);
                        return d;
                    case TO_MONTH:
                        d.setUTCHours(0, 0, 0, 0);
                        d.setUTCDate(1);
                        return d;
                    default: {
                        const step = SCALE_YEARS[scale] || 1;
                        d.setUTCHours(0, 0, 0, 0);
                        // setUTCFullYear, not Date.UTC — the latter folds 0-99 into the 1900s.
                        d.setUTCFullYear(mathFloor(d.getUTCFullYear() / step) * step, 0, 1);
                        return d;
                    }
                }
            },
            
            /*  Smallest boundary at or after the given instant.
                
                Idempotent on exact boundaries: an instant already sitting on a
                tick returns itself, so a range ending exactly at midnight does
                not gain a spurious extra day of axis. */
            roundForwardToScale: (dateObj, scale) => {
                const src = toDate(dateObj),
                    d = timeUtil.roundBackToScale(src, scale);
                if (d.getTime() === src.getTime()) return d;
                return timeUtil.advanceScale(d, scale, 1);
            },
            
            /*  Step a boundary by whole units of the scale. Use this to walk out
                the ticks between the two ends.
                
                Months and years CANNOT be stepped by adding a constant number of
                milliseconds — month lengths vary and leap years make a century
                24 or 25 days longer than 100 * 365. Only the sub-day scales are
                fixed-width. */
            advanceScale: (dateObj, scale, count=1) => {
                const d = new Date(toDate(dateObj).getTime()),
                    fixed = SCALE_MILLIS[scale];
                if (fixed) return new Date(d.getTime() + fixed * count);
                if (scale === TO_MONTH) {
                    d.setUTCMonth(d.getUTCMonth() + count);
                    return d;
                }
                d.setUTCFullYear(d.getUTCFullYear() + (SCALE_YEARS[scale] || 1) * count);
                return d;
            },
            
            /*  Every tick covering [from, to] inclusive of both boundaries.
                Guards against a step that cannot terminate. */
            ticksForRange: (from, to, scale, limit=2000) => {
                const end = timeUtil.roundForwardToScale(to, scale),
                    out = [];
                let cur = timeUtil.roundBackToScale(from, scale);
                while (cur.getTime() <= end.getTime() && out.length < limit) {
                    out.push(cur);
                    const next = timeUtil.advanceScale(cur, scale, 1);
                    if (next.getTime() <= cur.getTime()) break;
                    cur = next;
                }
                return out;
            }
        };
})(tc);
