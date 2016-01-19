import * as ts from 'typescript';
import * as Lint from 'tslint/lib/lint';
import ErrorTolerantWalker = require('./ErrorTolerantWalker');
import SyntaxKind = require('./SyntaxKind');
import AstUtils = require('./AstUtils');

/**
 * This exists so that you can try to tell the types of variables
 * and identifiers in the current scope.
 */
class ScopedSymbolTrackingWalker extends ErrorTolerantWalker {

    protected languageServices: ts.LanguageService;
    protected typeChecker : ts.TypeChecker;
    protected scope: Scope;

    constructor(sourceFile : ts.SourceFile, options : Lint.IOptions, languageServices : ts.LanguageService) {
        super(sourceFile, options);
        this.languageServices = languageServices;
        this.typeChecker = this.languageServices.getProgram().getTypeChecker();  // ts code is invalid
    }

    protected isExpressionEvaluatingToFunction(expression : ts.Expression) : boolean {
        if (expression.kind === SyntaxKind.current().ArrowFunction
            || expression.kind === SyntaxKind.current().FunctionExpression) {
            return true; // arrow function literals and arrow functions are definitely functions
        }

        if (expression.kind === SyntaxKind.current().StringLiteral
            || expression.kind === SyntaxKind.current().NoSubstitutionTemplateLiteral
            || expression.kind === SyntaxKind.current().TemplateExpression
            || expression.kind === SyntaxKind.current().TaggedTemplateExpression
            || expression.kind === SyntaxKind.current().BinaryExpression) {
            return false; // strings and binary expressions are definitely not functions
        }

        // is the symbol something we are tracking in scope ourselves?
        if (this.scope.isFunctionSymbol(expression.getText())) {
            return true;
        }

        if (expression.kind === SyntaxKind.current().Identifier) {
            let typeInfo : ts.DefinitionInfo[] = this.languageServices.getTypeDefinitionAtPosition('file.ts', expression.getStart());
            if (typeInfo != null && typeInfo[0] != null) {
                if (typeInfo[0].kind === 'function' || typeInfo[0].kind === 'local function') {
                    return true; // variables with type function are OK to pass
                }
            }
            return false;
        }

        if (expression.kind === SyntaxKind.current().CallExpression) {

            // calling Function.bind is a special case that makes tslint throw an exception
            if ((<any>expression).expression.name && (<any>expression).expression.name.getText() === 'bind') {
                return true; // for now assume invoking a function named bind returns a function. Follow up with tslint.
            }

            try {
                // seems like another tslint error of some sort
                let signature : ts.Signature = this.typeChecker.getResolvedSignature(<ts.CallExpression>expression);
                let expressionType : ts.Type = this.typeChecker.getReturnTypeOfSignature(signature);
                return this.isTypeFunction(expressionType, this.typeChecker);
            } catch (e) {
                // this exception is only thrown in unit tests, not the node debugger :(
                return false;
            }
        }

        return this.isTypeFunction(this.typeChecker.getTypeAtLocation(expression), this.typeChecker);
    }

    private isTypeFunction(expressionType : ts.Type, typeChecker : ts.TypeChecker) : boolean {
        let signatures : ts.Signature[] = typeChecker.getSignaturesOfType(expressionType, ts.SignatureKind.Call);
        if (signatures != null && signatures.length > 0) {
            let signatureDeclaration : ts.SignatureDeclaration = signatures[0].declaration;
            if (signatureDeclaration.kind === SyntaxKind.current().FunctionType) {
                return true; // variables of type function are allowed to be passed as parameters
            }
        }
        return false;
    }

    protected visitSourceFile(node: ts.SourceFile): void {
        this.scope = new Scope(null);
        this.scope.addGlobalScope(node, node, this.getOptions());
        super.visitSourceFile(node);
        this.scope = null;
    }

    protected visitModuleDeclaration(node: ts.ModuleDeclaration): void {
        this.scope = new Scope(this.scope);
        this.scope.addGlobalScope(node.body, this.getSourceFile(), this.getOptions());
        super.visitModuleDeclaration(node);
        this.scope = this.scope.parent;
    }

    protected visitClassDeclaration(node: ts.ClassDeclaration): void {
        this.scope = new Scope(this.scope);
        node.members.forEach((element: ts.ClassElement): void => {
            var prefix: string = AstUtils.isStatic(element)
                ? node.name.getText() + '.'
                : 'this.';

            if (element.kind === SyntaxKind.current().MethodDeclaration) {
                // add all declared methods as valid functions
                this.scope.addFunctionSymbol(prefix + (<ts.MethodDeclaration>element).name.getText());
            } else if (element.kind === SyntaxKind.current().PropertyDeclaration) {
                let prop: ts.PropertyDeclaration = <ts.PropertyDeclaration>element;
                // add all declared function properties as valid functions
                if (isDeclarationFunctionType(prop)) {
                    this.scope.addFunctionSymbol(prefix + (<ts.MethodDeclaration>element).name.getText());
                } else {
                    this.scope.addNonFunctionSymbol(prefix + (<ts.MethodDeclaration>element).name.getText());
                }
            }
        });
        super.visitClassDeclaration(node);
        this.scope = this.scope.parent;
    }

    protected visitFunctionDeclaration(node: ts.FunctionDeclaration): void {
        this.scope = new Scope(this.scope);
        this.scope.addParameters(node.parameters);
        super.visitFunctionDeclaration(node);
        this.scope = this.scope.parent;
    }

    protected visitConstructorDeclaration(node: ts.ConstructorDeclaration): void {
        this.scope = new Scope(this.scope);
        this.scope.addParameters(node.parameters);
        super.visitConstructorDeclaration(node);
        this.scope = this.scope.parent;
    }

    protected visitMethodDeclaration(node: ts.MethodDeclaration): void {
        this.scope = new Scope(this.scope);
        this.scope.addParameters(node.parameters);
        super.visitMethodDeclaration(node);
        this.scope = this.scope.parent;
    }


    protected visitArrowFunction(node: ts.FunctionLikeDeclaration): void {
        this.scope = new Scope(this.scope);
        this.scope.addParameters(node.parameters);
        super.visitArrowFunction(node);
        this.scope = this.scope.parent;
    }


    protected visitFunctionExpression(node: ts.FunctionExpression): void {
        this.scope = new Scope(this.scope);
        this.scope.addParameters(node.parameters);
        super.visitFunctionExpression(node);
        this.scope = this.scope.parent;
    }

    protected visitSetAccessor(node: ts.AccessorDeclaration): void {
        this.scope = new Scope(this.scope);
        this.scope.addParameters(node.parameters);
        super.visitSetAccessor(node);
        this.scope = this.scope.parent;
    }
}

function isDeclarationFunctionType(node: ts.PropertyDeclaration | ts.VariableDeclaration | ts.ParameterDeclaration): boolean {
    if (node.type != null) {
        return node.type.kind === SyntaxKind.current().FunctionType;
    } else if (node.initializer != null) {
        return (node.initializer.kind === SyntaxKind.current().ArrowFunction
            || node.initializer.kind === SyntaxKind.current().FunctionExpression);
    }
    return false;
}

class GlobalReferenceCollector extends ErrorTolerantWalker {

    public functionIdentifiers: string[] = [];
    public nonFunctionIdentifiers: string[] = [];

    /* tslint:disable:no-empty */
    protected visitModuleDeclaration(node: ts.ModuleDeclaration): void { }   // do not descend into fresh scopes
    protected visitClassDeclaration(node: ts.ClassDeclaration): void { }     // do not descend into fresh scopes
    protected visitArrowFunction(node: ts.FunctionLikeDeclaration): void { } // do not descend into fresh scopes
    protected visitFunctionExpression(node: ts.FunctionExpression): void { } // do not descend into fresh scopes
    /* tslint:enable:no-empty */

    public visitNode(node: ts.Node): void {
        super.visitNode(node);
    }

    protected visitVariableDeclaration(node: ts.VariableDeclaration): void {
        if (isDeclarationFunctionType(node)) {
            this.functionIdentifiers.push(node.name.getText());
        } else {
            this.nonFunctionIdentifiers.push(node.name.getText());
        }
        // do not descend
    }
}

class Scope {
    public parent: Scope;
    private symbols: { [index: string]: number } = {};

    constructor(parent: Scope) {
        this.parent = parent;
    }

    public addFunctionSymbol(symbolString: string): void {
        this.symbols[symbolString] = SyntaxKind.current().FunctionType;
    }

    public addNonFunctionSymbol(symbolString: string): void {
        this.symbols[symbolString] = SyntaxKind.current().Unknown;
    }

    public isFunctionSymbol(symbolString: string): boolean {
        if (this.symbols[symbolString] === SyntaxKind.current().FunctionType) {
            return true;
        }
        if (this.symbols[symbolString] === SyntaxKind.current().Unknown) {
            return false;
        }
        if (this.parent != null) {
            return this.parent.isFunctionSymbol(symbolString);
        }
        return false;
    }

    public addParameters(parameters: ts.ParameterDeclaration[]): void {
        parameters.forEach((parm: ts.ParameterDeclaration): void => {
            if (isDeclarationFunctionType(parm)) {
                this.addFunctionSymbol(parm.name.getText());
            } else {
                this.addNonFunctionSymbol(parm.name.getText());
            }
        });
    }

    public addGlobalScope(node: ts.Node, sourceFile : ts.SourceFile, options : Lint.IOptions): void {
        var refCollector = new GlobalReferenceCollector(sourceFile, options);
        refCollector.visitNode(node);
        refCollector.functionIdentifiers.forEach((identifier: string): void => { this.addFunctionSymbol(identifier); });
        refCollector.nonFunctionIdentifiers.forEach((identifier: string): void => { this.addNonFunctionSymbol(identifier); });
    }
}

export = ScopedSymbolTrackingWalker;
