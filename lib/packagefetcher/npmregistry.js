var path = require('path');
var slasp = require('slasp');
var nijs = require('nijs');
var semver = require('semver');
var npmconf = require('npmconf');
var RegClient = require('npm-registry-client');
var client;

/* Initialize client on first startup or return the existing one */

function initClient(callback) {
    if(client === undefined) {
        slasp.sequence([
            function(callback) {
                /* Load NPM's configuration */
                npmconf.load(callback);
            },
            
            function(callback, config) {
                client = new RegClient(config);
                callback(null, client);
            }
        ], callback)
    } else {
        callback(null, client);
    }
}

/**
 * @member packagefetcher.npmregistry
 *
 * Fetches a Node.js package's metadata (the package.json and source code
 * reference) from the NPM registry.
 *
 * @param {String} baseDir Directory in which the referrer's package.json configuration resides
 * @param {String} dependencyName Name of the Node.js package to fetch
 * @param {String} versionSpec Version specifier of the Node.js package to fetch, which is a exact version number, or version range specifier, '*', 'latest', or 'unstable'
 * @param {String} registryURL URL of the NPM registry
 * @param {function(String, Object)} callback Callback function that gets invoked when the work is done.
 *     If some error ocurred, the error parameter is set to contain the error message.
 *     If the operation succeeds, it returns an object with the package configuration and a Nix object that fetches the source
 */
function fetchMetaDataFromNPMRegistry(baseDir, dependencyName, versionSpec, registryURL, callback) {
    var self = this;
    
    if(versionSpec == "") // An empty versionSpec translates to *
        versionSpec = "*";
        
    slasp.sequence([
        initClient,
        
        function(callback, client) {
            
            /* Fetch package.json from the registry using the dependency name and version specification */
            var url = registryURL + "/" + dependencyName.replace("/", "%2F"); // Escape / to make scoped packages work
            
            client.get(url, {}, function(err, data, raw, res) {
                if(err) {
                    callback(err);
                } else {
                    callback(null, data);
                }
            });
        },
        
        function(callback, result) {
            
            if(result === undefined || result.versions === undefined) {
                callback("Error fetching package: " + dependencyName + " from NPM registry!");
            } else {
                /* Fetch the right version (and corresponding metadata) from the versions object */
                var versionIdentifiers = Object.keys(result.versions);
                
                if(semver.validRange(versionSpec, true) === null) { // If the version specifier is not a valid semver range, we consider it a tag which we need to resolve to a version
                    versionSpec = result['dist-tags'][versionSpec];
                }
                
                // Take the right version's metadata from the versions object
                var resolvedVersion = semver.maxSatisfying(versionIdentifiers, versionSpec, true);
                
                if(resolvedVersion === null) {
                    callback("Cannot resolve version: "+ dependencyName + "@" + versionSpec);
                } else {
                    var packageObj = result.versions[resolvedVersion];
                
                    /* Return metadata object */
                    
                    callback(null, {
                        packageObj: packageObj,
                        identifier: dependencyName + "-" + packageObj.version,
                        src: new nijs.NixFunInvocation({
                            funExpr: new nijs.NixExpression("fetchurl"),
                            paramExpr: {
                                url: packageObj.dist.tarball,
                                sha1: packageObj.dist.shasum
                            }
                        }),
                        baseDir: path.join(baseDir, dependencyName)
                    });
                }
            }
        }
    ], callback);
}

exports.fetchMetaDataFromNPMRegistry = fetchMetaDataFromNPMRegistry;
