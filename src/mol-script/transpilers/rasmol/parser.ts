/**
 * Copyright (c) 2017-2021 mol* contributors, licensed under MIT, See LICENSE file for more info.
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 * @author Panagiotis Tourlas <panagiot_tourlov@hotmail.com>
 * @author Koya Sakuma
 * This module is based on jmol tranpiler from MolQL and modified in similar manner as pymol and vmd tranpilers.
 **/


import * as P from '../../../mol-util/monadic-parser';
import * as h from '../helper';
import { MolScriptBuilder } from '../../../mol-script/language/builder';
const B = MolScriptBuilder;
import { properties, structureMap, structureDict } from './properties';
import { special_properties } from './special_properties';
import { special_keywords } from './special_keywords';
import { special_operators } from './special_operators';
import { operators } from './operators';
import { keywords } from './keywords';
import { AtomGroupArgs } from '../types';
import { Transpiler } from '../transpiler';
import { OperatorList } from '../types';

// const propertiesDict = h.getPropertyRules(properties);

// const slash = P.MonadicParser.string('/');

const propertiesDict = h.getPropertyRules(special_properties);

const slash = P.MonadicParser.string('/');
const dot = P.MonadicParser.string('.');
const colon = P.MonadicParser.string(':');
const comma = P.MonadicParser.string(',');
const star = P.MonadicParser.string('*');
const bra = P.MonadicParser.string('[');
const ket = P.MonadicParser.string(']');
const numbers = P.MonadicParser.regexp(/[0-9]/);

/* is Parser -> MonadicParser substitution correct? */
function orNull(rule: P.MonadicParser<any>) {
    return rule.or(P.MonadicParser.of(null));
}


function atomSelectionQuery2(x: any) {
    const tests: AtomGroupArgs = {};
    const props: { [k: string]: any[] } = {};

    for (const k in x) {
        const ps = special_properties[k];
        if (!ps) {
            throw new Error(`property '${k}' not supported, value '${x[k]}'`);
        }
        if (x[k] === null) continue;
        if (!props[ps.level]) props[ps.level] = [];
        props[ps.level].push(x[k]);
    }

    for (const p in props) {
        tests[p] = h.andExpr(props[p]);
    }

    return B.struct.generator.atomGroups(tests);
}



// <, <=, =, >=, >, !=, and LIKE
const valueOperators: OperatorList = [
    {
        '@desc': 'value comparisons',
        '@examples': [],
        name: '=',
        abbr: ['=='],
        type: h.binaryLeft,
        rule: P.MonadicParser.regexp(/\s*(LIKE|>=|<=|=|!=|>|<)\s*/i, 1),
        map: (op, e1, e2) => {
            // console.log(op, e1, e2)
            let expr;
	     if (e1 === 'structure') {
                expr = B.core.flags.hasAny([B.ammp('secondaryStructureFlags'), structureMap(e2)]);
            } else if (e2 === 'structure') {
                expr = B.core.flags.hasAny([B.ammp('secondaryStructureFlags'), structureMap(e1)]);
            } else if (e1.head !== undefined) {
                if (e1.head.name === 'core.type.regex') {
                    expr = B.core.str.match([e1, B.core.type.str([e2])]);
                }
            } else if (e2.head !== undefined) {
                if (e2.head.name === 'core.type.regex') {
                    expr = B.core.str.match([e2, B.core.type.str([e1])]);
                }
            } else if (op.toUpperCase() === 'LIKE') {
                if (e1.head) {
                    expr = B.core.str.match([
                        B.core.type.regex([`^${e2}$`, 'i']),
                        B.core.type.str([e1])
                    ]);
                } else {
                    expr = B.core.str.match([
                        B.core.type.regex([`^${e1}$`, 'i']),
                        B.core.type.str([e2])
                    ]);
                }
            }
            if (!expr) {
                if (e1.head) e2 = h.wrapValue(e1, e2);
                if (e2.head) e1 = h.wrapValue(e2, e1);
                switch (op) {
                    case '=':
                        expr = B.core.rel.eq([e1, e2]);
                        break;
                    case '!=':
                        expr = B.core.rel.neq([e1, e2]);
                        break;
                    case '>':
                        expr = B.core.rel.gr([e1, e2]);
                        break;
                    case '<':
                        expr = B.core.rel.lt([e1, e2]);
                        break;
                    case '>=':
                        expr = B.core.rel.gre([e1, e2]);
                        break;
                    case '<=':
                        expr = B.core.rel.lte([e1, e2]);
                        break;
                    default: throw new Error(`value operator '${op}' not supported`);
                }
            }
            return B.struct.generator.atomGroups({ 'atom-test': expr });
        }
    }
];

function atomExpressionQuery(x: any[]) {
    const [resno, inscode, chainname, atomname, altloc] = x[1];
    const tests: AtomGroupArgs = {};

    if (chainname) {
    // should be configurable, there is an option in Jmol to use auth or label
        tests['chain-test'] = B.core.rel.eq([B.ammp('auth_asym_id'), chainname]);
    }

    const resProps = [];
    if (resno) resProps.push(B.core.rel.eq([B.ammp('auth_seq_id'), resno]));
    if (inscode) resProps.push(B.core.rel.eq([B.ammp('pdbx_PDB_ins_code'), inscode]));
    if (resProps.length) tests['residue-test'] = h.andExpr(resProps);

    const atomProps = [];
    if (atomname) atomProps.push(B.core.rel.eq([B.ammp('auth_atom_id'), atomname]));
    if (altloc) atomProps.push(B.core.rel.eq([B.ammp('label_alt_id'), altloc]));
    if (atomProps.length) tests['atom-test'] = h.andExpr(atomProps);

    return B.struct.generator.atomGroups(tests);
}

const lang = P.MonadicParser.createLanguage({
    Integer: () => P.MonadicParser.regexp(/-?[0-9]+/).map(Number).desc('integer'),

    Parens: function (r: any) {
        return P.MonadicParser.alt(
            r.Parens,
            r.Operator,
            r.Expression
        ).wrap(P.MonadicParser.string('('), P.MonadicParser.string(')'));
    },

    Expression: function (r: any) {
        return P.MonadicParser.alt(
	    //	    r.NamedAtomProperties,
//	    r.AtomExpression.map(atomExpressionQuery),
	    r.AtomSelectionMacro.map(atomSelectionQuery2),
//	    r.AtomSelectionMacroResi.map(atomSelectionQuery2),
//	    r.Keywords,
//            r.Resno.lookahead(P.MonadicParser.regexp(/\s*(?!(LIKE|>=|<=|!=|[:^%/.=><]))/i)).map((x: any) => B.struct.generator.atomGroups({
//                'residue-test': B.core.rel.eq([B.ammp('auth_seq_id'), x])
//            })),
//            r.ValueQuery,
  //          r.Element.map((x: string) => B.struct.generator.atomGroups({
//                'atom-test': B.core.rel.eq([B.acp('elementSymbol'), B.struct.type.elementSymbol(x)])
  //          })),
  //          r.Resname.map((x: string) => B.struct.generator.atomGroups({
    //            'residue-test': B.core.rel.eq([B.ammp('label_comp_id'), x])
      //      })),
        );
    },


    //    lys:a.ca  -> resn lys and chain A and name ca
    //    lys*a.ca  -> resn lys and chain A and name ca
    //
    //    :a.ca -> chain A and name ca
    //    *a.ca -> chain A and name ca
    //
    //    *.cg -> name ca
    //    :.cg -> name ca
    AtomSelectionMacro: function (r: any) {
        return P.MonadicParser.alt(
            colon.then(P.MonadicParser.alt(
                P.MonadicParser.seq(                
                    orNull(propertiesDict.chain).skip(dot),
                    orNull(propertiesDict.name)
                ).map(x => { return { chain: x[0], name: x[1]}; }),
                P.MonadicParser.seq(
                    orNull(propertiesDict.name).skip(dot)
                ).map(x => { return {name: x[0] }; }),
            )),
	    star.then(P.MonadicParser.alt(
                P.MonadicParser.seq(                
                    orNull(propertiesDict.chain).skip(dot),
                    orNull(propertiesDict.name)
                ).map(x => { return { chain: x[0], name: x[1]}; }),
                P.MonadicParser.seq(
                    orNull(propertiesDict.name).skip(dot)
                ).map(x => { return {name: x[0] }; }),
            )),
	    // 1-100 lys:a.ca lys:a lys lys.ca
//	    numbers.then(P.MonadicParser.alt(
//		P.MonadicParser.alt(
//		    P.MonadicParser.seq(
//			orNull(propertiesDict.resi),
//		    ).map(x => { return { resi: x[0] };})
//		))),
            P.MonadicParser.alt(
                P.MonadicParser.seq(
                    orNull(propertiesDict.resn).skip(colon),
                    orNull(propertiesDict.chain).skip(dot),
                    orNull(propertiesDict.name)
                ).map(x => { return { resn: x[0], chain: x[1], name: x[2] }; }),
		P.MonadicParser.seq(
                    orNull(propertiesDict.resn).skip(star),
                    orNull(propertiesDict.chain).skip(dot),
                    orNull(propertiesDict.name)
                ).map(x => { return { resn: x[0], chain: x[1], name: x[2] }; }),
                P.MonadicParser.seq(
                    orNull(propertiesDict.resn).skip(colon),
                    orNull(propertiesDict.chain),
                ).map(x => { return { resn: x[0], chain: x[1] }; }),
		P.MonadicParser.seq(
                    orNull(propertiesDict.resn).skip(star),
                    orNull(propertiesDict.chain),
                ).map(x => { return { resn: x[0], chain: x[1] }; }),
		P.MonadicParser.seq(
                    orNull(propertiesDict.resn).skip(dot),
                    orNull(propertiesDict.name),
                ).map(x => { return { resn: x[0], name: x[1] }; }),
		P.MonadicParser.seq(
                    orNull(propertiesDict.resn),
		).map(x => {  return { resn: x[0] };}),
	    ),
        );
    },

    AtomSelectionMacroResi: function (r: any) {
        return P.MonadicParser.alt(
            P.MonadicParser.alt(
                P.MonadicParser.seq(
                    orNull(propertiesDict.resi)
                ).map(x => {  return { resi: x[0] };}),
	    ),
        );
    },

    ObjectProperty: () => {
	const w = h.getReservedWords(special_properties, special_keywords, special_operators)
              .sort(h.strLenSortFn).map(h.escapeRegExp).join('|');
        return P.MonadicParser.regexp(new RegExp(`(?!(${w}))[A-Z0-9_]+`, 'i'));
    },
    Object: (r: any) => {
        return r.ObjectProperty.notFollowedBy(slash)
            .map((x: any) => { throw new Error(`property 'object' not supported, value '${x}'`); });
    },



    NamedAtomProperties: function () {
        return P.MonadicParser.alt(...h.getNamedPropertyRules(properties));
    },

        ValueRange: function (r: any) {
        return P.MonadicParser.seq(
            r.Value
                .skip(P.MonadicParser.regexp(/-/i)),
            r.Value
        ).map(x => ({ range: x }));
    },

    RangeListProperty: function (r: any) {
        return P.MonadicParser.seq(
            P.MonadicParser.alt(...h.getPropertyNameRules(special_properties, /\s/))
                .skip(P.MonadicParser.whitespace),
            P.MonadicParser.alt(
                r.ValueRange,
                r.Value
            ).sepBy1(comma)
        ).map(x => {
            const [property, values] = x;
            const listValues: (string | number)[] = [];
            const rangeValues: any[] = [];

            values.forEach((v: any) => {
                if (v.range) {
                    rangeValues.push(
                        B.core.rel.inRange([property, v.range[0], v.range[1]])
                    );
                } else {
                    listValues.push(h.wrapValue(property, v, structureDict));
                }
            });

            const rangeTest = h.orExpr(rangeValues);
            const listTest = h.valuesTest(property, listValues);

            let test;
            if (rangeTest && listTest) {
                test = B.core.logic.or([rangeTest, listTest]);
            } else {
                test = rangeTest ? rangeTest : listTest;
            }

	    return B.struct.generator.atomGroups({ [h.testLevel(property)]: test });
        });
    },

    Operator: function (r: any) {
        return h.combineOperators(operators, P.MonadicParser.alt(r.Parens, r.Expression));
    },

    AtomExpression: function (r: any) {
        return P.MonadicParser.seq(
            P.MonadicParser.lookahead(r.AtomPrefix),
            P.MonadicParser.seq(
		r.ResnoRange.or(P.MonadicParser.of(null)),
                r.Resno.or(P.MonadicParser.of(null)),
//		r.Resno2.or(P.MonadicParser.of(null)),
                r.Inscode.or(P.MonadicParser.of(null)),
                r.Chainname.or(P.MonadicParser.of(null)),
//		r.Chainname2.or(P.MonadicParser.of(null)),
                r.Atomname.or(P.MonadicParser.of(null)),
                r.Altloc.or(P.MonadicParser.of(null)),
                r.Model.or(P.MonadicParser.of(null))),
        );
    },

    AtomPrefix: () => P.MonadicParser.regexp(/[0-9:^%/.]/).desc('atom-prefix'),
    Chainname: () => P.MonadicParser.regexp(/:([A-Za-z]{1,3})/, 1).desc('chainname'),
//    Chainname2: () => P.MonadicParser.regexp(/\*([A-Za-z]{1,3})/, 1).desc('chainname'),
    Model: () => P.MonadicParser.regexp(/\/([0-9]+)/, 1).map(Number).desc('model'),
    Element: () => P.MonadicParser.regexp(/_([A-Za-z]{1,3})/, 1).desc('element'),
    Atomname: () => P.MonadicParser.regexp(/\.([a-zA-Z0-9]{1,4})/, 1).map(B.atomName).desc('atomname'),
    Resname: () => P.MonadicParser.regexp(/[a-zA-Z0-9]{1,4}/).desc('resname'),
    Resno: (r: any) => r.Integer.desc('resno'),
//    Resno2: (r: any) => r.split(',').Integer.desc('resno'),
    Altloc: () => P.MonadicParser.regexp(/%([a-zA-Z0-9])/, 1).desc('altloc'),
    Inscode: () => P.MonadicParser.regexp(/\^([a-zA-Z0-9])/, 1).desc('inscode'),


    //    function listMap(x: string) { return x.split(',').map(x => x.replace(/^["']|["']$/g, '')); }



    BracketedResname: function (r: any) {
        return P.MonadicParser.regexp(/\.([a-zA-Z0-9]{1,4})/, 1)
	    .desc('bracketed-resname');
        // [0SD]
    },

    ResnoRange: function (r: any) {
        return P.MonadicParser.regexp(/\.([\s]){1,3}/, 1)
	    .desc('resno-range');
        // 123-200
        // -12--3
    },

    Keywords: () => P.MonadicParser.alt(...h.getKeywordRules(keywords)),

    Query: function (r: any) {
        return P.MonadicParser.alt(
            r.Operator,
            r.Parens,
            r.Expression
        ).trim(P.MonadicParser.optWhitespace);
    },

    Number: function () {
        return P.MonadicParser.regexp(/-?(0|[1-9][0-9]*)([.][0-9]+)?([eE][+-]?[0-9]+)?/)
            .map(Number)
            .desc('number');
    },

    String: function () {
        const w = h.getReservedWords(properties, keywords, operators)
            .sort(h.strLenSortFn).map(h.escapeRegExp).join('|');
        return P.MonadicParser.alt(
            P.MonadicParser.regexp(new RegExp(`(?!(${w}))[A-Z0-9_]+`, 'i')),
            P.MonadicParser.regexp(/'((?:[^"\\]|\\.)*)'/, 1),
            P.MonadicParser.regexp(/"((?:[^"\\]|\\.)*)"/, 1).map(x => B.core.type.regex([`^${x}$`, 'i']))
        );
    },

    Value: function (r: any) {
        return P.MonadicParser.alt(r.Number, r.String);
    },

    ValueParens: function (r: any) {
        return P.MonadicParser.alt(
            r.ValueParens,
            r.ValueOperator,
            r.ValueExpressions
        ).wrap(P.MonadicParser.string('('), P.MonadicParser.string(')'));
    },

    ValuePropertyNames: function () {
        return P.MonadicParser.alt(...h.getPropertyNameRules(properties, /LIKE|>=|<=|=|!=|>|<|\)|\s/i));
    },

    ValueOperator: function (r: any) {
        return h.combineOperators(valueOperators, P.MonadicParser.alt(r.ValueParens, r.ValueExpressions));
    },

    ValueExpressions: function (r: any) {
        return P.MonadicParser.alt(
            r.Value,
            r.ValuePropertyNames
        );
    },

    ValueQuery: function (r: any) {
        return P.MonadicParser.alt(
            r.ValueOperator.map((x: any) => {
                if (x.head.name) {
                    if (x.head.name.startsWith('structure-query.generator')) return x;
                } else {
                    if (typeof x === 'string' && x.length <= 4) {
                        return B.struct.generator.atomGroups({
                            'residue-test': B.core.rel.eq([B.ammp('label_comp_id'), x])
                        });
                    }
                }
                throw new Error(`values must be part of an comparison, value '${x}'`);
            })
        );
    }
});

export const transpiler: Transpiler = str => lang.Query.tryParse(str);
