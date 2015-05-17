"use strict"

load ('base.js');

// load individual benchmarks

load ('kernel-template.js');
load ('skinning.js');

function printResult (str) {
  print (str);
}

function printError (str) {
  print (str);
}

function printScore (str) {
  print (str);
}

benchmarks.runAll ({notifyResult: printResult,
                    notifyError:  printError,
                    notifyScore:  printScore},
                   true);
