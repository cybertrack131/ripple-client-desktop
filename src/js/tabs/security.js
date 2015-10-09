var util = require('util');
var Tab  = require('../client/tab').Tab;
var Base58Utils = require('../util/base58');
var RippleAddress = require('../util/types').RippleAddress;
var fs = require('fs');

var SecurityTab = function ()
{
  Tab.call(this);
};

util.inherits(SecurityTab, Tab);

SecurityTab.prototype.tabName = 'security';
SecurityTab.prototype.mainMenu = 'security';

SecurityTab.prototype.generateHtml = function ()
{
  return require('../../templates/tabs/security.jade')();
};

SecurityTab.prototype.angular = function (module) {
  module.controller('SecurityCtrl', ['$scope', 'rpId', 'rpKeychain', '$timeout',
    'rpAuthFlow', 'rpPopup', 'rpNetwork', 'rpFileDialog',
    function ($scope, $id, keychain, $timeout, authflow, popup, network, fileDialog)
  {
    if (!$id.loginStatus) $id.goId();

    $scope.settingsPage = 'security';
    
    $scope.showComponent = [];

    $scope.isUnlocked = true; //hiding the dialog for now
    //$scope.isUnlocked = keychain.isUnlocked($id.account);
    $scope.requirePasswordChanged = false;
   
    $scope.validation_pattern_phone = /^[0-9]*$/;

    $scope.$on('$blobUpdate', onBlobUpdate);
    onBlobUpdate();

    $scope.security = {};

    function saveTransaction(tx) {
      tx.tx_json.Sequence = Number($scope.sequence);
      $scope.incrementSequence();
      tx.tx_json.Fee = $scope.fee;
      tx.complete();
      $scope.signedTransaction = tx.sign().serialize().to_hex();
      $scope.txJSON = JSON.stringify(tx.tx_json);
      $scope.hash = tx.hash('HASH_TX_ID', false, undefined);
      $scope.mode = "offlineSending";
      if ($scope.userBlob.data.defaultDirectory) {
        var sequenceNumber = (Number(tx.tx_json.Sequence));
        var sequenceLength = sequenceNumber.toString().length;
        var txnName = $scope.userBlob.data.account_id + '-' + new Array(10 - sequenceLength + 1).join('0') + sequenceNumber + '.txt';
        var txData = JSON.stringify({
          tx_json: tx.tx_json,
          hash: $scope.hash,
          tx_blob: $scope.signedTransaction
        });
        var fileName = $scope.userBlob.data.defaultDirectory + '/' + txnName;
        fs.writeFile(fileName, txData, function(err) {
          $scope.$apply(function() {
            $scope.fileName = fileName;
            console.log('saved file');
            if (err) {
              console.log('Error saving transaction: ', JSON.stringify(err));
              $scope.error = true;
            } else {
              $scope.saved = true;
            }
          });
        });
      }
    }

    function onBlobUpdate()
    {
      if ("function" === typeof $scope.userBlob.encrypt) {
        $scope.enc = $scope.userBlob.encrypt();
      }
      

      $scope.requirePassword = !$scope.userBlob.data.persistUnlock;
    }

    $scope.restoreSession = function() {

      if (!$scope.sessionPassword) {
        $scope.unlockError = true;
        return;
      }

      $scope.isConfirming = true;
      $scope.unlockError  = null;

      keychain.getSecret($id.account, $id.username, $scope.sessionPassword, function(err, secret) {
        $scope.isConfirming = false;
        $scope.sessionPassword = '';
        
        if (err) {
          $scope.unlockError = err;
          return;
        }

        $scope.isUnlocked = keychain.isUnlocked($id.account);
      });

    };


    $scope.unmaskSecret = function () {
      keychain.requestSecret($id.account, $id.username, 'showSecret', function (err, secret) {
        if (err) {
          // XXX Handle error
          return;
        }

        $scope.security.master_seed = secret;
      });
    };


    $scope.setPasswordProtection = function () {
      $scope.editUnlock = false;
      
      //ignore it if we are not going to change anything
      if (!$scope.requirePasswordChanged) return;
      $scope.requirePasswordChanged = false;
      $scope.requirePassword        = !$scope.requirePassword;
      
      keychain.setPasswordProtection($scope.requirePassword, function(err, resp){
        if (err) {
          console.log(err);
          $scope.requirePassword = !$scope.requirePassword;
          //TODO: report errors to user
        }
      });
    };

    $scope.cancelUnlockOptions = function () {
      $scope.editUnlock = false;
    };

    $scope.changePassword = function() {
      $scope.loading = true;
      $scope.error = false;

      // Get the master key
      keychain.getSecret($id.account, $id.username, $scope.password,
          function (err, masterkey) {
            if (err) {
              console.log("client: account tab: error while " +
                  "unlocking wallet: ", err);

              $scope.error = 'wrongpassword';
              $scope.loading = false;
              return;
            }

            // Change password
            $id.changePassword({
              username: $id.username,
              password: $scope.password1,
              masterkey: masterkey,
              blob: $scope.userBlob
            }, function(err){
              if (err) {
                console.log('client: account tab: error while ' +
                    'changing the account password: ', err);
                $scope.error = true;
                $scope.loading = false;
                return;
              }

              $scope.success = true;
              reset();
            });
          }
      );
    };

    function requestToken (force, callback) {
      authflow.requestToken($scope.userBlob.url, $scope.userBlob.id, force, function(tokenError, tokenResp) {
        $scope.via = tokenResp.via;

        callback(tokenError, tokenResp);
      });
    }

    $scope.requestToken = function () {
      var force = $scope.via === 'app' ? true : false;
      
      $scope.isRequesting = true;
      requestToken(force, function(err, resp) {
        $scope.isRequesting = false;
        //TODO: present message of resend success or failure
      });
    };

    // Generate a regular key
    $scope.generateRegularKey = function() {
      $scope.regularKey = Base58Utils.encode_base_check(33, sjcl.codec.bytes.fromBits(sjcl.random.randomWords(4)));
      $scope.regularKeyPublic = new RippleAddress($scope.regularKey).getAddress();

      var tx = network.remote.transaction();

      tx.on('success', function (res) {
        console.log('success', res);
      });

      tx.on('proposed', function (res) {
        console.log('proposed', res);
      });

      tx.on('error', function (res) {
        console.log('error', res);
      });

      // Attach the key to the account
      keychain.requestSecret($id.account, $id.username, function (err, secret) {
        tx.secret(secret);
        tx.setRegularKey({
          account: $scope.address,
          regular_key: $scope.regularKeyPublic
        });
        if ($scope.onlineMode) {
          tx.submit();
        } else {
          saveTransaction(tx);
        }
      });

      // Save the key in the blob
      $scope.userBlob.set("/regularKey", $scope.regularKey);
    };

    $scope.removeRegularKey = function() {
      var tx = network.remote.transaction();

      tx.on('success', function (res) {
        console.log('success', res);
      });

      tx.on('proposed', function (res) {
        console.log('proposed', res);
      });

      tx.on('error', function (res) {
        console.log('error', res);
      });

      keychain.requestSecret($id.account, $id.username, function (err, secret) {
        tx.secret(secret);
        tx.setRegularKey({
          account: $scope.address
        });
        if ($scope.onlineMode) {
          tx.submit();
        } else {
          saveTransaction(tx);
        }
      });

      // Remove the key from the blob
      $scope.userBlob.unset("/regularKey");
    };

    $scope.saveRegularKey = function() {
      fileDialog.saveAs(function(filename) {
        $scope.userBlob.persistRegular(filename);
      }, 'wallet-regular.txt');
    };

    var reset = function() {
      $scope.openFormPassword = false;
      $scope.password1 = '';
      $scope.password2 = '';
      $scope.passwordSet = {};
      $scope.loading = false;
      $scope.error = false;

      if ($scope.changeForm) {
        $scope.changeForm.$setPristine(true);
      }
  };

  reset();
  $scope.success = false;

  }]);
};

module.exports = SecurityTab;
