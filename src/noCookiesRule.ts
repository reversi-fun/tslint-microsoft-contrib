
import * as ts from 'typescript';
import * as Lint from 'tslint/lib/lint';

//import ErrorTolerantWalker = require('./utils/ErrorTolerantWalker');
import ScopedSymbolTrackingWalker = require('./utils/ScopedSymbolTrackingWalker');
import AstUtils = require('./utils/AstUtils');

/**
 * Implementation of the no-cookies-rule rule.
 */
export class Rule extends Lint.Rules.AbstractRule {
    public static FAILURE_STRING = 'Forbidden call to document.cookie';

    public apply(sourceFile : ts.SourceFile): Lint.RuleFailure[] {
        var compilerOptions: ts.CompilerOptions ;
        //compilerOptions = Lint.createCompilerOptions();
        //compilerOptions.module = ts.ModuleKind.CommonJS;
        //compilerOptions.noResolve = false;
        compilerOptions = <ts.CompilerOptions>{ target: ts.ScriptTarget.ES5, module: ts.ModuleKind.CommonJS, noResolve: false};
        var curProgram: ts.Program = ts.createProgram([sourceFile.fileName], compilerOptions);
        var curTypeChecker: ts.TypeChecker = curProgram.getTypeChecker();

        var documentRegistry = ts.createDocumentRegistry();
        var languageServiceHost = Lint.createLanguageServiceHost('file.ts' /* sourceFile.fileName*/, sourceFile.getFullText());
        var languageService : ts.LanguageService = ts.createLanguageService(languageServiceHost, documentRegistry);
        //return this.applyWithWalker(new NoCookiesWalker(sourceFile, this.getOptions(), languageService));
        //return this.applyWithWalker(new NoCookiesWalker(sourceFile, this.getOptions(), languageService, curTypeChecker)); //workarounds failed
        return this.applyWithWalker(new NoCookiesWalker(curProgram.getSourceFile(sourceFile.fileName), this.getOptions(), languageService, curTypeChecker)); //workarounds
    }
}

class NoCookiesWalker extends ScopedSymbolTrackingWalker /* ErrorTolerantWalker Lint.RuleWalker*/ {

    //protected languageServices : ts.LanguageService; // from ScopedSymbolTrackingWalker
    //protected typeChecker : ts.TypeChecker; // from ScopedSymbolTrackingWalker

    constructor(sourceFile: ts.SourceFile, options: Lint.IOptions, languageService : ts.LanguageService, /*workarounds*/ typeChecker : ts.TypeChecker) {
        //super(sourceFile, options);
        super(sourceFile, options , languageService);
        this.languageServices = languageService;
        //this.typeChecker = languageService.getProgram().getTypeChecker(); /*workarounds*/
        this.typeChecker = typeChecker; /*workarounds*/
    }


    protected visitPropertyAccessExpression(node: ts.PropertyAccessExpression): void {
        var propertyName = node.name.text;
        if (propertyName === 'cookie') {

            var leftSide : ts.Expression = node.expression;
            try {
                var leftSideType: ts.Type = this.typeChecker.getTypeAtLocation(leftSide);
                var typeAsString: string = this.typeChecker.typeToString(leftSideType);
                if (leftSideType.flags === ts.TypeFlags.Any || typeAsString === 'Document') {
                    this.addFailure(this.createFailure(leftSide.getStart(), leftSide.getWidth(), Rule.FAILURE_STRING));
                }
            } catch (e) {
                // TODO: this error seems like a tslint error
                if (leftSide.getFullText().trim() === 'document') {
                    this.addFailure(this.createFailure(leftSide.getStart(), leftSide.getWidth(), Rule.FAILURE_STRING));
                }
            }
        }

        super.visitPropertyAccessExpression(node);
    }
    protected visitIdentifier(node: ts.Identifier): void {
        super.visitIdentifier(node);
        AstUtils.dumpTypeInfo(node, this.languageServices, this.typeChecker);
    }

}
