/*
Copyright IBM All Rights Reserved.

SPDX-License-Identifier: Apache-2.0
*/
module.exports = function(RED) {
  var __isDebug = process.env.d10Debug || false;
  var __moduleName = 'D10_documentMgr';


  console.log("*****************************************");
  console.log("* Debug mode is " + (__isDebug ? "enabled" : "disabled") + ' for module ' + __moduleName);
  console.log("*****************************************");

  function D10_documentMgr(config) {
    RED.nodes.createNode(this, config);
    this.application = RED.nodes.getNode(config.application);
    var node = this;
    const { __log, __logJson, __logError, __logWarning, __getOptionValue, __getMandatoryInputFromSelect, __getMandatoryInputString, __getOptionalInputString } = require('../common/common.js');
    //
    //  Get the dominoDB runtime
    //
    const { useServer } = require('@domino/domino-db');

    //
    //  ON Handler
    //
    this.on("input", function(msg) {
      const betweenQuotes = /"([^"\\]*(\\.[^"\\]*)*)"/;
      const parExp = /(\S+)\s*=\s*([^\s"]+|"[^"]*")/;
      let documentOp = '';
      let unid  = null;
      let itemNames = [];
      let itemValues = [];
      let options = {};
      let options2 = {};
      const arrayToObject = (array, keyField) =>
      array.reduce((obj, item) => {
        obj[item[keyField]] = item.value;
        return obj;
      }, {});
//
      //  Check for token on start up
      //
      if (!node.application) {
        __logError(__moduleName, "Please configure your Domino DB first!", null, null, msg, node);
        return;
      }
      let creds = node.application.getCredentials();
      //
      //  Which Operation ?
      //
      documentOp = __getMandatoryInputFromSelect(__moduleName, config.documentOp, msg.DDB_documentOp, 'DocumentOp', ['read', 'create', 'replace', 'delete', 'replaceItems', 'deleteItems'], msg, node);
      if (!documentOp) return;
      //
      //  Document Id
      //
      if (documentOp !== 'create') {
        unid = __getMandatoryInputString(__moduleName, config.unid, msg.DDB_unid, 'Document Id', msg, node);
        if (!unid) return;
      } else {
        unid = '';
      }
      //
      //  Comma-separated list of itemNames
      //
      switch (documentOp) {
        case 'read':
        case 'deleteItems':
          itemNames = __getMandatoryInputString(__moduleName, config.itemNames, msg.DDB_itemNames, 'itemNames', msg, node);
          if (!itemNames) return;
          //
          //  Transform comma-separated string into array
          //
          itemNames = itemNames.trim().split(',');
          for (let i=0; i < itemNames.length; i++) {
            itemNames[i] = itemNames[i].trim();
          }
          break;
        case 'create':
        case 'replace':
        case 'replaceItems':
          let _itemValues = [];
          if ((config.itemValues.trim() === '') && (!msg.DDB_itemValues || !Array.isArray(msg.DDB_itemValues))) {
            __logError(__moduleName, "No Item Values", null, null, msg, node);
            //
            //  No Items to be modified! 
            //
            return;
          } else {
            if (config.itemValues.trim() !== '') {
              //
              //  List of properties is a comma-separated list of  name=value
              //
              let theList = config.itemValues.trim().split(',');
              for (let i=0; i < theList.length; i++) {
                let tt = theList[i].match(parExp);
                if (tt) {
                  //
                  //  well written name = value   pair
                  //
                  let theItem = {};
                  theItem.name = tt[1].trim();
                  let tmpS = tt[2].trim();
                  if (tmpS.match(betweenQuotes)) {
                    theItem.value = tmpS.match(betweenQuotes)[1];
                  } else {
                    theItem.value = tmpS;
                  }
                  _itemValues.push(theItem);
                }
              }
              //
              //  Now we should have processed all the pairs in the config input
              //
            } else {
              //
              //  if inpput comes as "msg.DDB_itemValues" we assume that it is already formatted as an array of name and values
              //
              _itemValues = msg.DDB_itemValues;
            }
          }
          //
          //  Now transform the array into an object
          //
          itemValues = arrayToObject(_itemValues, "name");
          //
          //  And calculate the itemNames into its array
          //
          for (let i=0; i < _itemValues.length; i++){
            itemNames.push(_itemValues[i].name);
          }
          break;
      }
      //
      //  Preparing
      //
      switch (documentOp) {
        case 'read':
          options = {itemNames : itemNames};
          break;
        case 'create':
        case 'replace':
          options = {document : itemValues};
          options2 = {itemNames : itemNames};
          break;
        case 'delete':
          options = {};
          break;
        case 'replaceItems':
          options = {replaceItems : itemValues};
          options2 = {itemNames : itemNames};
          break;
        case 'deleteItems':
          options = {itemNames : itemNames};
          break;
      }
      __logJson(__moduleName, __isDebug, "executing operation " + documentOp + " with the following options: ", options);
      
      const serverConfig = {
        hostName: creds.D10_server, 
        connection: {
          port: creds.D10_port, 
        },
      };
      const databaseConfig = {
        filePath: creds.D10_db
      };

      useServer(serverConfig).then(async server => {
        //
        //  Get the Domino Database
        //
        let db;
        try {
          db = await server.useDatabase(databaseConfig);
        } catch (err) {
          __logError(__moduleName, "Error Accessing database config", databaseConfig, err, msg, node);
          return;
        }
        //
        //  Get One document using useDocument
        //
        let useDocument;
        if (documentOp != 'create') {
          try {
            useDocument = await db.useDocument({unid: unid});
          } catch (err) {
            __logError(__moduleName, "Error using document with unique id " + unid, null, err, msg, node);
            return;
          }
        }
        //
        //  Define the output document
        //
        let myDocument;
        let isStrangeError = false;
        try {
          switch (documentOp) {
            case 'read':
              //
              //  Read a Document from useDocument
              //
              myDocument = await useDocument.read(options);
              __logJson(__moduleName, __isDebug, 'read document:', myDocument);
              break;
            case 'create':
              //
              //  Create a Document and return It
              //
              unid = await db.createDocument(options);
              useDocument = await db.useDocument({unid: unid});
              myDocument = await useDocument.read(options2);
              __logJson(__moduleName, __isDebug, 'created document:', myDocument);
            case 'replace':
              //
              //  Replace a Document and return It
              //
              await useDocument.replace(options);
              myDocument = await useDocument.read(options2);
              __logJson(__moduleName, __isDebug, 'replaced document:', myDocument);
              break;
            case 'delete':
              await useDocument.delete();
              try {
                myDocument = await useDocument.read({});
                __logError(__moduleName, "Error Deleting document with uniqueId = " + unid, null, null, msg, node);
                return;
              } catch (e) {
                __log(__moduleName, __isDebug, 'document with uniqueId ' + unid + ' has been deleted !');
                myDocument = {};
              }
              break;
            case 'replaceItems':
              await useDocument.replaceItems(options);
              myDocument = await useDocument.read(options2);
              __logJson(__moduleName, __isDebug, 'replaced Items in document:', myDocument);
              break;
            case 'deleteItems':
              await useDocument.deleteItems(options);
              myDocument = await useDocument.read(options2);
              __logJson(__moduleName, __isDebug, 'deleted Items in document:', myDocument);
              break;
          }
        } catch (err) {
          __logError(__moduleName, 'Error performing ' + documentOp +  ' on document qualified by the unique Id : ' + unid, null, err, msg, node);
          return;
        }
        //
        //  Prepare output
        //
        msg.DDB_doc = myDocument;
        msg.DDB_unid = unid;
        node.status({fill:"green", shape:"dot", text:"OK"});
        node.send(msg);
        //
        //  Reset visual status on success
        //
        setTimeout(() => {node.status({});}, 2000);
      })
      .catch(err => {
        __logError(__moduleName, "Error accessing Server with the following configuration", serverConfig, err, msg, node);
        return;
      });
    });
    //
    //  CLOSE Handler
    //
    this.on('close', function(removed, done) {
      if (removed) {
          // This node has been deleted
      } else {
          // This node is being restarted
      }
      done();
    });
  }

  //
  //  Node Registration
  //
  RED.nodes.registerType("D10_documentMgr", D10_documentMgr);
};
